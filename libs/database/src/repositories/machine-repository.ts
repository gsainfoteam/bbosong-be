import { Loggable } from '@lib/logger';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '@lib/database/database.service';
import { Gender, Machine, MachinePower, Prisma } from 'generated/prisma/client';
import { LaundryRoomSummary } from '@lib/database/types/machine.type';
import {
  CreateMachineReqDto,
  CreateMultipleMachinesReqDto,
} from 'src/machine/dto/req/create-machine-req.dto';

@Loggable()
@Injectable()
export class MachineRepository {
  private readonly logger = new Logger(MachineRepository.name);
  constructor(private readonly databaseService: DatabaseService) {}

  async getLaundryRoomStatusByRoom(
    gender: Gender,
  ): Promise<LaundryRoomSummary[]> {
    const unusedGroups = await this.databaseService.machine
      .groupBy({
        by: ['location', 'gender', 'type'],
        where: {
          gender: gender,
          isAvailable: true,
          currentUsage: {
            is: null,
          },
        },
        _count: {
          uuid: true,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `getLaundryRoomStatusByRoom prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`getLaundryRoomStatusByRoom error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });

    return unusedGroups.map((group) => ({
      location: group.location,
      gender: group.gender,
      type: group.type,
      unusedCount: group._count.uuid,
    }));
  }

  async createMachine(data: CreateMachineReqDto): Promise<Machine> {
    return this.databaseService.machine
      .create({
        data,
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2002') {
            throw new ConflictException('Machine already exists.');
          }
          this.logger.error(`createMachine prisma error: ${error.message}`);
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`createMachine error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  async createMultipleMachines(
    data: CreateMultipleMachinesReqDto,
  ): Promise<Machine[]> {
    const itemCount = data.endIndex - data.startIndex + 1;

    const machines = await this.databaseService.machine
      .createManyAndReturn({
        data: Array.from({ length: itemCount }, (_, i) => {
          const currentIndex = data.startIndex + i;

          return {
            uuid: crypto.randomUUID(),
            type: data.type,
            location: data.location,
            gender: data.gender,
            index: currentIndex,
          };
        }),
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2002') {
            throw new ConflictException('Machine already exists.');
          }
          this.logger.error(
            `createMultipleMachines prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`createMultipleMachines error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });

    return machines.sort((a, b) => a.index - b.index);
  }

  async getMachines(): Promise<Machine[]> {
    return await this.databaseService.machine
      .findMany({
        orderBy: [
          { location: 'asc' },
          { gender: 'asc' },
          { type: 'asc' },
          { index: 'asc' },
        ],
      })
      .catch((error) => {
        this.logger.error(`getMachines error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  async deleteMachine(uuid: string): Promise<void> {
    await this.databaseService.machine
      .delete({
        where: {
          uuid: uuid,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2025') {
            throw new NotFoundException('Machine not found.');
          }
          this.logger.error(`deleteMachine prisma error: ${error.message}`);
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`deleteMachine error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  async recordMachinePower(uuid: string, power: number): Promise<void> {
    await this.databaseService.machinePower
      .create({
        data: {
          machineUuid: uuid,
          power,
        },
      })
      .catch((error) => {
        this.logger.error(`recordMachinePower error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  async getMachinePowerInLastHour(uuid: string): Promise<MachinePower[]> {
    // Calculate timestamp for 1 hour ago
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    return await this.databaseService.machinePower
      .findMany({
        where: {
          machineUuid: uuid,
          recordedAt: {
            gte: oneHourAgo,
          },
        },
        orderBy: {
          recordedAt: 'asc',
        },
      })
      .catch((error) => {
        this.logger.error(`getMachinePowerInLastHour error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }
}
