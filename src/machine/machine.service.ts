import { Loggable } from '@lib/logger';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Gender,
  Machine,
  MachinePower,
  UsingMachine,
} from 'generated/prisma/client';
import { MachineRepository } from '@lib/database/repositories/machine.repository';
import { UsingMachineRepository } from '@lib/database/repositories/using-machine.repository';
import { LaundryRoomSummary } from '@lib/database/types/machine.type';
import { NotificationService } from '../notification/notification.service';
import {
  CreateMachineReqDto,
  CreateMultipleMachinesReqDto,
} from './dto/req/create-machine-req.dto';
import { CreatePowerReqDto } from './dto/req/create-power-req.dto';
import { UpdateMachineReqDto } from './dto/req/update-machine-req.dto';

@Loggable()
@Injectable()
export class MachineService {
  private readonly logger = new Logger(MachineService.name);

  constructor(
    private readonly machineRepository: MachineRepository,
    private readonly usingMachineRepository: UsingMachineRepository,
    private readonly notificationService: NotificationService,
  ) {}

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

  async updateMachine(uuid: string, updateMachineReqDto: UpdateMachineReqDto) {
    await this.machineRepository.updateMachine(
      uuid,
      updateMachineReqDto.isAvailable,
      updateMachineReqDto.posX,
      updateMachineReqDto.posY,
    );
  }

  async deleteMachine(uuid: string) {
    await this.machineRepository.deleteMachine(uuid);
  }

  async recordMachinePower(uuid: string, { power }: CreatePowerReqDto) {
    await this.machineRepository.recordMachinePower(uuid, power);
  }

  async getMachinePower(uuid: string): Promise<MachinePower[]> {
    return await this.machineRepository.getMachinePowerInLastHour(uuid);
  }

  // Enable machine completion notification for the operating user
  async enableMachineNotification(
    userUuid: string,
    machineUuid: string,
  ): Promise<void> {
    const count = await this.usingMachineRepository.enableMachineNotification(
      userUuid,
      machineUuid,
    );
    if (count === 0) {
      throw new NotFoundException(
        'Machine is not running or operating user mismatch.',
      );
    }
  }

  // Disable machine completion notification for the operating user
  async disableMachineNotification(
    userUuid: string,
    machineUuid: string,
  ): Promise<void> {
    const count = await this.usingMachineRepository.disableMachineNotification(
      userUuid,
      machineUuid,
    );
    if (count === 0) {
      throw new NotFoundException(
        'Machine is not running or operating user mismatch.',
      );
    }
  }

  // Unlink user from machine usage (set userUuid to null)
  async unlinkUserFromMachine(
    userUuid: string,
    machineUuid: string,
  ): Promise<void> {
    const count = await this.usingMachineRepository.unlinkUserFromUsingMachine(
      userUuid,
      machineUuid,
    );
    if (count === 0) {
      throw new NotFoundException(
        'Machine is not running or operating user mismatch.',
      );
    }
  }

  // Start machine run session
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

  // Finish machine run session and trigger push notifications
  async finishUsingMachine(machineUuid: string): Promise<void> {
    const usingMachine =
      await this.usingMachineRepository.getUsingMachineByMachineUuid(
        machineUuid,
      );
    const machines = await this.machineRepository.getMachines();
    const machine = machines.find((m) => m.uuid === machineUuid);

    await this.usingMachineRepository.deleteUsingMachine(machineUuid);

    if (machine) {
      if (usingMachine?.notifyOnCompletion && usingMachine.userUuid) {
        try {
          await this.notificationService.notifyMachineCompletion(
            usingMachine.userUuid,
            machine,
          );
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error
              ? (error.stack ?? error.message)
              : typeof error === 'object' && error !== null
                ? JSON.stringify(error)
                : String(error);

          this.logger.error(
            `Failed to dispatch completion notification for machine ${machineUuid}: ${errorMessage}`,
          );
        }
      }

      try {
        await this.notificationService.notifyLaundryRoomAvailable(
          machine.location,
          machine.gender,
          machine.type,
        );
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error
            ? (error.stack ?? error.message)
            : typeof error === 'object' && error !== null
              ? JSON.stringify(error)
              : String(error);

        this.logger.error(
          `Failed to dispatch laundry room availability notification for machine ${machineUuid}: ${errorMessage}`,
        );
      }
    }
  }

  // Get active usingMachine status
  async getUsingMachine(machineUuid: string): Promise<UsingMachine | null> {
    return await this.usingMachineRepository.getUsingMachineByMachineUuid(
      machineUuid,
    );
  }
}
