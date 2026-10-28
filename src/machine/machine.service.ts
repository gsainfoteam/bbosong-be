import { MACHINE_REREGISTRATION_MIN_DURATION_MS } from '@lib/database/constants/machine-registration';
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
  ConflictException,
  ForbiddenException,
  HttpStatus,
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
import type { ThinqDryerState } from '../thinq/thinq.service';

const MACHINE_ON_POWER_THRESHOLD_WATTS = 10;
const MACHINE_ON_DURATION_MS = 180_000;
const MATTER_POWER_UNITS_PER_WATT = 1000;

@Loggable()
@Injectable()
@Trace()
export class MachineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MachineService.name);
  private unsubscribePowerListener?: () => Promise<void>;
  private readonly machineTypesByMacAddress = new Map<string, MachineType>();
  private readonly machineUuidsByMacAddress = new Map<string, string>();
  private readonly thinqMacAddresses = new Set<string>();
  private readonly machineStatusesByMacAddress = new Map<
    string,
    MachineStatus
  >();
  private readonly powerBelowThresholdTimers = new Map<
    string,
    NodeJS.Timeout
  >();
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
        if (machine.type === MachineType.DRYER && machine.thinqDeviceId) {
          this.thinqMacAddresses.add(machine.macAddress);
        }
        this.machineTypesByMacAddress.set(machine.macAddress, machine.type);
        this.machineUuidsByMacAddress.set(machine.macAddress, machine.uuid);
        this.machineStatusesByMacAddress.set(
          machine.macAddress,
          machine.status,
        );
      }

      // ThinQ dryers are identified by deviceId, without a Matter MAC or commission.
      if (machine.type === MachineType.DRYER && machine.thinqDeviceId) continue;

      if (machine.isCommissioned) {
        if (!machine.macAddress) {
          throw new Error(
            `Machine ${machine.uuid} mac address is not set but it is commissioned`,
          );
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
    if (!this.thinqMacAddresses.has(macAddress)) {
      if (isBelowThreshold) {
        this.scheduleIdleAfterLowPower(macAddress);
      } else {
        this.clearPowerBelowThresholdTimer(macAddress);
      }
    }

    try {
      await this.machineRepository.recordMachinePowerByMacAddress(
        macAddress,
        powerWatts,
      );

      if (this.thinqMacAddresses.has(macAddress)) return;

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
        if (this.thinqMacAddresses.has(macAddress) || !shouldUpdate()) return;

        const previousStatus = this.machineStatusesByMacAddress.get(macAddress);
        if (previousStatus === status) return;

        await this.machineRepository.updateMachineStatusByMacAddress(
          macAddress,
          status,
        );

        const machineUuid = this.machineUuidsByMacAddress.get(macAddress);
        if (!machineUuid || previousStatus === undefined) {
          this.machineStatusesByMacAddress.set(macAddress, status);
          return;
        }

        try {
          if (status === MachineStatus.IDLE) {
            await this.finishUsingMachine(machineUuid);
          } else if (previousStatus === MachineStatus.IDLE) {
            await this.startUsingMachine(machineUuid);
          }
        } catch (error: unknown) {
          this.logger.error(
            `Failed to update usage for machine ${machineUuid}: ${formatError(error)}`,
          );
          return;
        }

        this.machineStatusesByMacAddress.set(macAddress, status);
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
    if (machine.shortUrl && machine.shortCode) return machine;
    if (machine.shortUrl) {
      return await this.machineRepository.updateMachineShortUrl(
        machine.uuid,
        machine.shortUrl,
        new URL(machine.shortUrl).pathname
          .replace(/\/+$/, '')
          .split('/')
          .pop()!,
      );
    }

    const machineRegisterUrl = this.configService.get<string>(
      'MACHINE_REGISTER_URL',
      'https://bbosong.gistory.me/machine-register',
    );
    const longUrl = `${machineRegisterUrl.replace(/\/+$/, '')}/${machine.uuid}`;
    const shortUrl = await this.shlinkService.ensureShortUrl(longUrl);
    return await this.machineRepository.updateMachineShortUrl(
      machine.uuid,
      shortUrl,
      new URL(shortUrl).pathname.replace(/\/+$/, '').split('/').pop()!,
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
      if (machine.shortUrl && machine.shortCode) continue;
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

  async getMachineDetailByShortCode(
    shortCode: string,
    userGender: Gender,
  ): Promise<MachineWithUsage> {
    const machine =
      await this.machineRepository.getMachineWithUsageByShortCode(shortCode);
    if (!machine) throw new NotFoundException('Machine not found.');
    this.ensureMachineGenderMatches(machine, userGender);
    return machine;
  }

  async getMachineDetail(
    uuid: string,
    userGender: Gender,
  ): Promise<MachineWithUsage> {
    const machine = await this.machineRepository.getMachineWithUsage(uuid);
    if (!machine) {
      throw new NotFoundException('Machine not found.');
    }

    this.ensureMachineGenderMatches(machine, userGender);
    return machine;
  }

  private ensureMachineGenderMatches(
    machine: Machine,
    userGender: Gender,
  ): void {
    if (machine.gender !== userGender) {
      throw new ForbiddenException(
        'Machine gender does not match user gender.',
      );
    }
  }

  async updateMachine(uuid: string, updateMachineReqDto: UpdateMachineReqDto) {
    const machine = await this.machineRepository.updateMachine(
      uuid,
      updateMachineReqDto.isAvailable,
      updateMachineReqDto.posX,
      updateMachineReqDto.posY,
      updateMachineReqDto.matterPayload,
      updateMachineReqDto.thinqDeviceId,
    );
    if (machine.macAddress) {
      if (machine.type === MachineType.DRYER && machine.thinqDeviceId) {
        this.thinqMacAddresses.add(machine.macAddress);
        this.clearPowerBelowThresholdTimer(machine.macAddress);
      } else {
        this.thinqMacAddresses.delete(machine.macAddress);
      }
      this.machineStatusesByMacAddress.set(machine.macAddress, machine.status);
    }
  }

  async updateThinqDryerState(
    uuid: string,
    deviceId: string,
    state: ThinqDryerState,
  ): Promise<void> {
    const currentState =
      typeof state.runState?.currentState === 'string'
        ? state.runState.currentState
        : null;
    // Local lifecycle policy: paused/cooling/wrinkle-care cycles still occupy a dryer.
    // Errors, reservations and unknown states do not imply completion.
    const status =
      currentState &&
      ['RUNNING', 'DETECTING', 'COOLING', 'PAUSE', 'WRINKLE_CARE'].includes(
        currentState,
      )
        ? MachineStatus.DRY
        : currentState &&
            ['END', 'POWER_OFF', 'SLEEP', 'INITIAL'].includes(currentState)
          ? MachineStatus.IDLE
          : null;
    const hour = state.timer?.remainHour;
    const minute = state.timer?.remainMinute;
    const remainingMinutes =
      typeof hour === 'number' &&
      typeof minute === 'number' &&
      Number.isInteger(hour) &&
      Number.isInteger(minute) &&
      hour >= 0 &&
      minute >= 0 &&
      minute < 60 &&
      hour * 60 + minute <= 2_147_483_647
        ? hour * 60 + minute
        : null;
    const count = await this.machineRepository.updateThinqDryerState(
      uuid,
      deviceId,
      currentState,
      remainingMinutes,
      status,
    );
    if (!count || !status) return;
    // These operations are idempotent and retried on the next successful poll.
    if (status === MachineStatus.DRY) {
      await this.startUsingMachine(uuid);
    } else {
      await this.finishUsingMachine(uuid);
    }
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
    userGender: Gender,
  ): Promise<void> {
    await this.getMachineDetail(machineUuid, userGender);
    const count = await this.usingMachineRepository.enableMachineNotification(
      userUuid,
      machineUuid,
    );
    if (count > 0) return;

    // Diagnose a failed conditional update using the latest usage record.
    const usingMachine = await this.getUsingMachine(machineUuid);
    if (!usingMachine) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: 'Machine is not running.',
        errorCode: 'MACHINE_NOT_RUNNING',
      });
    }

    if (
      usingMachine.userUuid &&
      usingMachine.userUuid !== userUuid &&
      Date.now() - usingMachine.startedAt.getTime() >=
        MACHINE_REREGISTRATION_MIN_DURATION_MS
    ) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: 'Confirm previous usage completion to register this machine.',
        errorCode: 'MACHINE_COMPLETION_CONFIRMATION_REQUIRED',
        usageUuid: usingMachine.uuid,
      });
    }

    throw new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: 'Machine is already registered to another user.',
      errorCode: 'MACHINE_ALREADY_REGISTERED',
    });
  }

  async confirmCompletedAndRegister(
    userUuid: string,
    machineUuid: string,
    userGender: Gender,
    usageUuid: string,
  ): Promise<void> {
    const machine = await this.getMachineDetail(machineUuid, userGender);
    const previous =
      await this.usingMachineRepository.confirmCompletedAndRegister(
        userUuid,
        machineUuid,
        usageUuid,
      );
    if (previous.userUuid) {
      await this.dispatchNotification(
        () =>
          this.notificationService.notifyMachineReregistered(
            previous.userUuid!,
            machine,
          ),
        `re-registration notification for machine ${machineUuid}`,
      );
    }
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

  async getUsageHistoryByUser(
    userUuid: string,
    limit: number,
    offset: number,
  ): Promise<UsingMachine[]> {
    return this.usingMachineRepository.getUsageHistoryByUser(
      userUuid,
      limit,
      offset,
    );
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
    userUuid?: string,
    notifyOnCompletion = true,
  ): Promise<UsingMachine> {
    return await this.usingMachineRepository.createUsingMachine(
      machineUuid,
      userUuid,
      notifyOnCompletion,
    );
  }

  async finishUsingMachine(machineUuid: string): Promise<void> {
    const usingMachine =
      await this.usingMachineRepository.finishUsingMachine(machineUuid);
    if (!usingMachine) return;

    const machine = await this.machineRepository.getMachine(machineUuid);
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
    if (machine.type === MachineType.DRYER && machine.thinqDeviceId) {
      throw new BadRequestException(
        'ThinQ dryers do not require Matter commissioning.',
      );
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
