import { Loggable } from '@lib/logger';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '@lib/database/database.service';
import { Gender, Machine, Prisma } from 'generated/prisma/client';
import { LaundryRoomSummary } from '@lib/database/types/machine.type';
import {
  CreateMachineReqDto,
  CreateMultipleMachinesReqDto,
} from '../../../../src/machine/dto/req/create-machine-req.dto';

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
            throw new ConflictException('Article already exists.');
          }
          this.logger.error(`createArticle prisma error: ${error.message}`);
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`createArticle error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  async createMultipleMachines(
    data: CreateMultipleMachinesReqDto,
  ): Promise<Machine[]> {
    const itemCount = data.endIndex - data.startIndex + 1;

    return this.databaseService.machine
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
}
