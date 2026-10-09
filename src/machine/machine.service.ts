import { Trace } from '@gsainfoteam/nest-observability';
import { MachineRepository } from '@lib/database/repositories/machine.repository';
import { UsingMachineRepository } from '@lib/database/repositories/using-machine.repository';
import {
  LaundryRoomSummary,
  MachineWithUsage,
} from '@lib/database/types/machine.type';
import { Loggable } from '@lib/logger';
import { MatterConnectionService } from '@lib/matter-client/matter-connection.service';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Gender,
  Machine,
  MachinePower,
  MachineStatus,
  MachineType,
  UsingMachine,
} from 'generated/prisma/client';
import { formatError } from 'src/common/utils/format-error.util';
import { NotificationService } from '../notification/notification.service';
import {
  CreateMachineReqDto,
  CreateMultipleMachinesReqDto,
} from './dto/req/create-machine-req.dto';
import { UpdateMachineReqDto } from './dto/req/update-machine-req.dto';
import { ShlinkService } from './shlink.service';

const MACHINE_ON_POWER_THRESHOLD_WATTS = 6;
const MACHINE_ON_DURATION_MS = 60_000;
const MATTER_POWER_UNITS_PER_WATT = 1000;

@Loggable()
@Injectable()
@Trace()
export class MachineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MachineService.name);
  private unsubscribePowerListener?: () => Promise<void>;
  private readonly machineTypesByMacAddress = new Map<string, MachineType>();
  private readonly machineUuidsByMacAddress = new Map<string, string>();
  private readonly machineStatusesByMacAddress = new Map<
    string,
    MachineStatus
  >();
  private readonly powerBelowThresholdTimers = new Map<string, NodeJS.Timeout>();
  private readonly latestPowerWattsByMacAddress = new Map<string, number>();
  private readonly statusUpdateQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly machineRepository: MachineRepository,
    private readonly usingMachineRepository: UsingMachineRepository,
    private readonly notificationService: NotificationService,
    private readonly matterConnectionService: MatterConnectionService,
    private readonly shlinkService: ShlinkService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const machines = await this.machineRepository.getMachines();
    for (const machine of machines) {
      if (machine.macAddress) {
        this.machineTypesByMacAddress.set(machine.macAddress, machine.type);
        this.machineUuidsByMacAddress.set(machine.macAddress, machine.uuid);
        this.machineStatusesByMacAddress.set(
          machine.macAddress,
          machine.status,
        );
      }

      if (machine.isCommissioned) {
        if (!machine.macAddress) {
          throw new Error(
            `Machine ${machine.uuid} mac address is not set but it is commissioned`,
          );
        }
        try {
          this.matterConnectionService.get(machine.macAddress);
        } catch (error) {
          console.error(
            `Machine ${machine.uuid} connection failed: ${error}, set isCommissioned to false`,
          );
          await this.machineRepository.resetMachineCommissioned(machine.uuid);
        }
      }
    }

    this.unsubscribePowerListener =
      this.matterConnectionService.addPowerListener((macAddress, power) =>
        this.handlePowerUpdate(macAddress, power),
      );
  }

  async onModuleDestroy() {
    await this.unsubscribePowerListener?.();
    for (const timer of this.powerBelowThresholdTimers.values()) {
      clearTimeout(timer);
    }
    this.powerBelowThresholdTimers.clear();
    this.latestPowerWattsByMacAddress.clear();
  }

  private async handlePowerUpdate(
    macAddress: string,
    power: number,
  ): Promise<void> {
    const powerWatts = power / MATTER_POWER_UNITS_PER_WATT;
    const isBelowThreshold = powerWatts < MACHINE_ON_POWER_THRESHOLD_WATTS;
    this.latestPowerWattsByMacAddress.set(macAddress, powerWatts);
    if (isBelowThreshold) {
      this.scheduleIdleAfterLowPower(macAddress);
    } else {
      this.clearPowerBelowThresholdTimer(macAddress);
    }

    try {
      await this.machineRepository.recordMachinePowerByMacAddress(
        macAddress,
        powerWatts,
      );

      if (isBelowThreshold) return;

      const machineType =
        this.machineTypesByMacAddress.get(macAddress) ??
        (await this.machineRepository.getMachineTypeByMacAddress(macAddress));
      if (!machineType) return;
      this.machineTypesByMacAddress.set(macAddress, machineType);

      const activeStatus =
        machineType === MachineType.WASHER
          ? MachineStatus.WASH
          : MachineStatus.DRY;
      await this.enqueueMachineStatusUpdate(
        macAddress,
        activeStatus,
        () =>
          (this.latestPowerWattsByMacAddress.get(macAddress) ?? 0) >=
          MACHINE_ON_POWER_THRESHOLD_WATTS,
      );
    } catch (error: unknown) {
      this.logger.error(
        `Failed to process power update for mac ${macAddress}: ${formatError(error)}`,
      );
    }
  }

  private scheduleIdleAfterLowPower(macAddress: string): void {
    if (this.powerBelowThresholdTimers.has(macAddress)) return;

    const timer = setTimeout(() => {
      if (this.powerBelowThresholdTimers.get(macAddress) !== timer) return;
      this.powerBelowThresholdTimers.delete(macAddress);
      void this.enqueueMachineStatusUpdate(
        macAddress,
        MachineStatus.IDLE,
        () =>
          (this.latestPowerWattsByMacAddress.get(macAddress) ?? 0) <
          MACHINE_ON_POWER_THRESHOLD_WATTS,
      ).catch((error: unknown) => {
        this.logger.error(
          `Failed to update status for mac ${macAddress}: ${formatError(error)}`,
        );
      });
    }, MACHINE_ON_DURATION_MS);
    this.powerBelowThresholdTimers.set(macAddress, timer);
  }

  private clearPowerBelowThresholdTimer(macAddress: string): void {
    const timer = this.powerBelowThresholdTimers.get(macAddress);
    if (!timer) return;

    clearTimeout(timer);
    this.powerBelowThresholdTimers.delete(macAddress);
  }

  private enqueueMachineStatusUpdate(
    macAddress: string,
    status: MachineStatus,
    shouldUpdate: () => boolean,
  ): Promise<void> {
    const previousUpdate =
      this.statusUpdateQueues.get(macAddress) ?? Promise.resolve();
    const update = previousUpdate
      .catch(() => undefined)
      .then(async () => {
        if (!shouldUpdate()) return;

        const previousStatus =
          this.machineStatusesByMacAddress.get(macAddress);
        if (previousStatus === status) return;

        await this.machineRepository.updateMachineStatusByMacAddress(
          macAddress,
          status,
        );
        this.machineStatusesByMacAddress.set(macAddress, status);

        const machineUuid = this.machineUuidsByMacAddress.get(macAddress);
        if (!machineUuid || previousStatus === undefined) return;

        try {
          if (status === MachineStatus.IDLE) {
            await this.finishUsingMachine(machineUuid);
          } else if (previousStatus === MachineStatus.IDLE) {
            await this.startUsingMachine(machineUuid, 0);
          }
        } catch (error: unknown) {
          this.logger.error(
            `Failed to update usage for machine ${machineUuid}: ${formatError(error)}`,
          );
        }
      });

    this.statusUpdateQueues.set(macAddress, update);
    const cleanup = () => {
      if (this.statusUpdateQueues.get(macAddress) === update) {
        this.statusUpdateQueues.delete(macAddress);
      }
    };
    void update.then(cleanup, cleanup);
    return update;
  }

  async laundryRoomStatusByGender(
    gender: Gender,
  ): Promise<LaundryRoomSummary[]> {
    return await this.machineRepository.getLaundryRoomStatusByRoom(gender);
  }

  async createMachine(
    createMachineReqDto: CreateMachineReqDto,
  ): Promise<Machine> {
    const machine =
      await this.machineRepository.createMachine(createMachineReqDto);
    try {
      return await this.ensureMachineLink(machine);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to create link for machine ${machine.uuid}: ${formatError(error)}`,
      );
      return machine;
    }
  }

  async createMultipleMachines(
    createMultipleMachinesReqDto: CreateMultipleMachinesReqDto,
  ): Promise<Machine[]> {
    const machines = await this.machineRepository.createMultipleMachines(
      createMultipleMachinesReqDto,
    );
    const results = await Promise.allSettled(
      machines.map((machine) => this.ensureMachineLink(machine)),
    );
    return results.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;

      const machine = machines[index];
      this.logger.error(
        `Failed to create link for machine ${machine.uuid}: ${formatError(result.reason)}`,
      );
      return machine;
    });
  }

  async getMachines(): Promise<Machine[]> {
    return await this.machineRepository.getMachines();
  }

  async ensureMachineLink(machine: Machine): Promise<Machine> {
    if (machine.shortUrl) return machine;

    const machineRegisterUrl = this.configService.get<string>(
      'MACHINE_REGISTER_URL',
      'https://bbosong.gistory.me/machine-register',
    );
    const longUrl = `${machineRegisterUrl.replace(/\/+$/, '')}/${machine.uuid}`;
    const shortUrl = await this.shlinkService.ensureShortUrl(longUrl);
    return await this.machineRepository.updateMachineShortUrl(
      machine.uuid,
      shortUrl,
    );
  }

  async ensureMachineLinkByUuid(uuid: string): Promise<Machine> {
    const machine = await this.machineRepository.getMachine(uuid);
    if (!machine) throw new NotFoundException('Machine not found.');
    return await this.ensureMachineLink(machine);
  }

  async backfillMachineLinks(): Promise<{
    created: number;
    failedUuids: string[];
  }> {
    const machines = await this.machineRepository.getMachines();
    const failedUuids: string[] = [];
    let created = 0;

    for (const machine of machines) {
      if (machine.shortUrl) continue;
      try {
        await this.ensureMachineLink(machine);
        created += 1;
      } catch (error: unknown) {
        this.logger.error(
          `Failed to backfill link for machine ${machine.uuid}: ${formatError(error)}`,
        );
        failedUuids.push(machine.uuid);
      }
    }

    return { created, failedUuids };
  }

  async getMachineDetail(uuid: string): Promise<MachineWithUsage> {
    const machine = await this.machineRepository.getMachineWithUsage(uuid);
    if (!machine) {
      throw new NotFoundException('Machine not found.');
    }

    return machine;
  }

  async updateMachine(uuid: string, updateMachineReqDto: UpdateMachineReqDto) {
    await this.machineRepository.updateMachine(
      uuid,
      updateMachineReqDto.isAvailable,
      updateMachineReqDto.posX,
      updateMachineReqDto.posY,
      updateMachineReqDto.matterPayload,
    );
  }

  async deleteMachine(uuid: string) {
    await this.machineRepository.deleteMachine(uuid);
  }

  async getMachinePower(uuid: string, from?: Date): Promise<MachinePower[]> {
    return await this.machineRepository.getMachinePowerFrom(uuid, from);
  }

  async enableMachineNotification(
    userUuid: string,
    machineUuid: string,
  ): Promise<void> {
    const count = await this.usingMachineRepository.enableMachineNotification(
      userUuid,
      machineUuid,
    );
    this.ensureMachineOperationAffected(count);
  }

  async disableMachineNotification(
    userUuid: string,
    machineUuid: string,
  ): Promise<void> {
    const count = await this.usingMachineRepository.disableMachineNotification(
      userUuid,
      machineUuid,
    );
    this.ensureMachineOperationAffected(count);
  }

  // Get machines currently being used by the given user
  async getUsingMachinesByUser(userUuid: string): Promise<UsingMachine[]> {
    return await this.usingMachineRepository.getUsingMachinesByUser(userUuid);
  }

  async unlinkUserFromMachine(
    userUuid: string,
    machineUuid: string,
  ): Promise<void> {
    const count = await this.usingMachineRepository.unlinkUserFromUsingMachine(
      userUuid,
      machineUuid,
    );
    this.ensureMachineOperationAffected(count);
  }

  private ensureMachineOperationAffected(count: number): void {
    if (count === 0) {
      throw new NotFoundException(
        'Machine is not running or operating user mismatch.',
      );
    }
  }

  async startUsingMachine(
    machineUuid: string,
    durationMinutes: number,
    userUuid?: string,
    notifyOnCompletion = true,
  ): Promise<UsingMachine> {
    return await this.usingMachineRepository.createUsingMachine(
      machineUuid,
      durationMinutes,
      userUuid,
      notifyOnCompletion,
    );
  }

  async finishUsingMachine(machineUuid: string): Promise<void> {
    const usingMachine =
      await this.usingMachineRepository.getUsingMachineByMachineUuid(
        machineUuid,
      );
    const machine = await this.machineRepository.getMachine(machineUuid);

    await this.usingMachineRepository.deleteUsingMachine(machineUuid);

    if (!machine) return;

    const notifyUserUuid = usingMachine?.notifyOnCompletion
      ? usingMachine.userUuid
      : null;
    if (notifyUserUuid) {
      await this.dispatchNotification(
        () =>
          this.notificationService.notifyMachineCompletion(
            notifyUserUuid,
            machine,
          ),
        `completion notification for machine ${machineUuid}`,
      );
    }

    await this.dispatchNotification(
      () =>
        this.notificationService.notifyLaundryRoomAvailable(
          machine.location,
          machine.gender,
          machine.type,
        ),
      `laundry room availability notification for machine ${machineUuid}`,
    );
  }

  private async dispatchNotification(
    action: () => Promise<void>,
    context: string,
  ): Promise<void> {
    try {
      await action();
    } catch (error: unknown) {
      this.logger.error(`Failed to dispatch ${context}: ${formatError(error)}`);
    }
  }

  async getUsingMachine(machineUuid: string): Promise<UsingMachine | null> {
    return await this.usingMachineRepository.getUsingMachineByMachineUuid(
      machineUuid,
    );
  }

  async commissionMachine(machineUuid: string): Promise<void> {
    const machine = await this.machineRepository.getMachine(machineUuid);
    if (!machine) {
      throw new NotFoundException('Machine not found.');
    }
    if (!machine.matterPayload) {
      throw new BadRequestException('Machine matter payload is not set.');
    }
    if (machine.isCommissioned) {
      throw new BadRequestException('Machine is already commissioned.');
    }

    const macAddress = await this.matterConnectionService.commission(
      machine.location,
      machine.matterPayload,
    );
    await this.machineRepository.updateMachineCommissioned(
      machineUuid,
      macAddress,
    );
    this.machineTypesByMacAddress.set(macAddress, machine.type);
    this.machineUuidsByMacAddress.set(macAddress, machine.uuid);
    this.machineStatusesByMacAddress.set(macAddress, machine.status);
  }
}
