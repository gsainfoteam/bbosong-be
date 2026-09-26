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
  OnModuleInit,
} from '@nestjs/common';
import {
  Gender,
  Machine,
  MachinePower,
  UsingMachine,
} from 'generated/prisma/client';
import { formatError } from 'src/common/utils/format-error.util';
import { NotificationService } from '../notification/notification.service';
import {
  CreateMachineReqDto,
  CreateMultipleMachinesReqDto,
} from './dto/req/create-machine-req.dto';
import { UpdateMachineReqDto } from './dto/req/update-machine-req.dto';
import { Cron, CronExpression } from '@nestjs/schedule';

@Loggable()
@Injectable()
@Trace()
export class MachineService implements OnModuleInit {
  private readonly logger = new Logger(MachineService.name);

  constructor(
    private readonly machineRepository: MachineRepository,
    private readonly usingMachineRepository: UsingMachineRepository,
    private readonly notificationService: NotificationService,
    private readonly matterConnectionService: MatterConnectionService,
  ) {}

  async onModuleInit() {
    const machines = await this.machineRepository.getMachines();
    for (const machine of machines) {
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
  }

  async laundryRoomStatusByGender(
    gender: Gender,
  ): Promise<LaundryRoomSummary[]> {
    return await this.machineRepository.getLaundryRoomStatusByRoom(gender);
  }

  async createMachine(
    createMachineReqDto: CreateMachineReqDto,
  ): Promise<Machine> {
    return await this.machineRepository.createMachine(createMachineReqDto);
  }

  async createMultipleMachines(
    createMultipleMachinesReqDto: CreateMultipleMachinesReqDto,
  ): Promise<Machine[]> {
    return await this.machineRepository.createMultipleMachines(
      createMultipleMachinesReqDto,
    );
  }

  async getMachines(): Promise<Machine[]> {
    return await this.machineRepository.getMachines();
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
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async pullMachinePower() {
    const machines = await this.machineRepository.getMachines({
      commissionedOnly: true,
    });
    for (const machine of machines) {
      if (!machine.macAddress) {
        this.logger.error(
          `Machine ${machine.uuid} mac address is not set but it is commissioned`,
        );
        continue;
      }
      const node = this.matterConnectionService.get(machine.macAddress);
      const path = Object.keys(node.attributes).find((k) =>
        k.endsWith('/144/8'),
      );
      const raw = path ? node.attributes[path] : undefined;
      const watts = typeof raw === 'number' ? raw / 1000 : null;
      if (watts === null) {
        this.logger.error(`Machine ${machine.uuid} power is not set`);
        continue;
      }
      await this.machineRepository.recordMachinePower(machine.uuid, watts);
    }
  }
}
