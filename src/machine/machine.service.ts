import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Gender,
  Machine,
  MachinePower,
  UsingMachine,
} from 'generated/prisma/client';
import { MachineRepository } from '@lib/database/repositories/machine.repository';
import { UsingMachineRepository } from '@lib/database/repositories/using-machine.repository';
import { LaundryRoomSummary } from '@lib/database/types/machine.type';
import {
  CreateMachineReqDto,
  CreateMultipleMachinesReqDto,
} from './dto/req/create-machine-req.dto';
import { CreatePowerReqDto } from './dto/req/create-power-req.dto';
import { UpdateMachineReqDto } from './dto/req/update-machine-req.dto';

@Injectable()
export class MachineService {
  constructor(
    private readonly machineRepository: MachineRepository,
    private readonly usingMachineRepository: UsingMachineRepository,
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

  async updateMachine(uuid: string, body: UpdateMachineReqDto) {
    return await this.machineRepository.updateMachine(
      uuid,
      body.isAvailable,
      body.posX,
      body.posY,
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

  // Finish machine run session
  async finishUsingMachine(machineUuid: string): Promise<void> {
    await this.usingMachineRepository.deleteUsingMachine(machineUuid);
  }

  // Get active usingMachine status
  async getUsingMachine(machineUuid: string): Promise<UsingMachine | null> {
    return await this.usingMachineRepository.getUsingMachineByMachineUuid(
      machineUuid,
    );
  }
}
