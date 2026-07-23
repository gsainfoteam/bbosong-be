import { Injectable } from '@nestjs/common';
import { Gender, Machine } from 'generated/prisma/client';
import { MachineRepository } from '@lib/database/repositories/machine-repository';
import { LaundryRoomSummary } from '@lib/database/types/machine.type';
import {
  CreateMachineReqDto,
  CreateMultipleMachinesReqDto,
} from './dto/req/create-machine-req.dto';

@Injectable()
export class MachineService {
  constructor(private readonly machineRepository: MachineRepository) {}

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

  async deleteMachine(uuid: string) {
    await this.machineRepository.deleteMachine(uuid);
  }
}
