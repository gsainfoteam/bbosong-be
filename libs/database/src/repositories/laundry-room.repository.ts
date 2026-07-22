import { Loggable } from '@lib/logger';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '@lib/database/database.service';
import { Gender, Prisma } from 'generated/prisma/client';
import { LaundryRoomSummary } from '@lib/database/types/laundry-room.type';
import { PrismaTransaction } from '../types';

@Loggable()
@Injectable()
export class LaundryRoomRepository {
  private readonly logger = new Logger(LaundryRoomRepository.name);
  constructor(private readonly databaseService: DatabaseService) {}

  async getLaundryRoomStatusByRoom(
    gender: Gender,
    tx?: PrismaTransaction,
  ): Promise<LaundryRoomSummary[]> {
    const client = tx ?? this.databaseService;

    const unusedGroups = await client.machine
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
}
