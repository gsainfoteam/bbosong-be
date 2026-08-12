import { Loggable } from '@lib/logger';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '@lib/database/database.service';

import { Location, Gender, MachineType, Prisma } from 'generated/prisma/client';
import { PrismaTransaction } from '@lib/database/types';

@Loggable()
@Injectable()
export class NotificationRepository {
  private readonly logger = new Logger(NotificationRepository.name);
  constructor(private readonly databaseService: DatabaseService) {}

  async registerPush(
    userUuid: string,
    endpoint: string,
    p256dh: string,
    auth: string,
    userAgent?: string,
  ) {
    return await this.databaseService.userPushSubscription
      .upsert({
        where: { endpoint: endpoint },
        create: {
          userUuid,
          endpoint,
          p256dh,
          auth,
          userAgent,
        },
        update: {
          userUuid,
          p256dh,
          auth,
          userAgent,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(`registerPush prisma error: ${error.message}`);
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`registerPush error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  async unregisterPush(userUuid: string, endpoint: string) {
    return await this.databaseService.userPushSubscription
      .deleteMany({
        where: { endpoint, userUuid },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(`unregisterPush prisma error: ${error.message}`);
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`unregisterPush error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  async getUserPushSubscriptions(userUuid: string) {
    return await this.databaseService.userPushSubscription
      .findMany({
        where: { userUuid },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `getUserPushSubscriptions prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`getUserPushSubscriptions error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  async createLaundryRoomSubscription(
    userUuid: string,
    location: Location,
    gender: Gender,
    type: MachineType,
  ) {
    return await this.databaseService.laundryRoomSubscription
      .upsert({
        where: {
          userUuid_location_gender_type: { userUuid, location, gender, type },
        },
        create: { userUuid, location, gender, type },
        update: {
          createdAt: new Date(),
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `createLaundryRoomSubscription prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`createLaundryRoomSubscription error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  async deleteLaundryRoomSubscription(
    userUuid: string,
    location: Location,
    gender: Gender,
    type: MachineType,
  ) {
    return await this.databaseService.laundryRoomSubscription
      .deleteMany({
        where: {
          userUuid,
          location,
          gender,
          type,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `deleteLaundryRoomSubscription prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`deleteLaundryRoomSubscription error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  async getLaundryRoomSubscribers(
    location: Location,
    gender: Gender,
    type: MachineType,
  ) {
    return await this.databaseService.laundryRoomSubscription
      .findMany({
        where: {
          location,
          gender,
          type,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `getLaundryRoomSubscribers prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`getLaundryRoomSubscribers error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  async deleteAllLaundryRoomSubscribers(
    location: Location,
    gender: Gender,
    type: MachineType,
  ) {
    return await this.databaseService.laundryRoomSubscription
      .deleteMany({
        where: {
          location,
          gender,
          type,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `deleteAllLaundryRoomSubscribers prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`deleteAllLaundryRoomSubscribers error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }
  async deleteAllUserPushSubscriptionsInTx(
    userUuid: string,
    tx: PrismaTransaction,
  ): Promise<void> {
    await tx.userPushSubscription
      .deleteMany({
        where: { userUuid },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `deleteAllUserPushSubscriptionsInTx prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`deleteAllUserPushSubscriptionsInTx error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  async deleteAllUserLaundryRoomSubscriptionsInTx(
    userUuid: string,
    tx: PrismaTransaction,
  ): Promise<void> {
    await tx.laundryRoomSubscription
      .deleteMany({
        where: { userUuid },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `deleteAllUserLaundryRoomSubscriptionsInTx prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(
          `deleteAllUserLaundryRoomSubscriptionsInTx error: ${error}`,
        );
        throw new InternalServerErrorException('Unknown Error');
      });
  }
}
