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

  private async run<T>(methodName: string, op: Promise<T>): Promise<T> {
    return await op.catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        this.logger.error(`${methodName} prisma error: ${error.message}`);
        throw new InternalServerErrorException('Database Error');
      }
      this.logger.error(`${methodName} error: ${error}`);
      throw new InternalServerErrorException('Unknown Error');
    });
  }

  async registerPush(
    userUuid: string,
    endpoint: string,
    p256dh: string,
    auth: string,
    userAgent?: string,
  ) {
    return this.run(
      'registerPush',
      this.databaseService.userPushSubscription.upsert({
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
      }),
    );
  }

  async unregisterPush(userUuid: string, endpoint: string) {
    return this.run(
      'unregisterPush',
      this.databaseService.userPushSubscription.deleteMany({
        where: { endpoint, userUuid },
      }),
    );
  }

  async getUserPushSubscriptions(userUuid: string) {
    return this.run(
      'getUserPushSubscriptions',
      this.databaseService.userPushSubscription.findMany({
        where: { userUuid },
      }),
    );
  }

  async createLaundryRoomSubscription(
    userUuid: string,
    location: Location,
    gender: Gender,
    type: MachineType,
  ) {
    return this.run(
      'createLaundryRoomSubscription',
      this.databaseService.laundryRoomSubscription.upsert({
        where: {
          userUuid_location_gender_type: { userUuid, location, gender, type },
        },
        create: { userUuid, location, gender, type },
        update: {
          createdAt: new Date(),
        },
      }),
    );
  }

  async deleteLaundryRoomSubscription(
    userUuid: string,
    location: Location,
    gender: Gender,
    type: MachineType,
  ) {
    return this.run(
      'deleteLaundryRoomSubscription',
      this.databaseService.laundryRoomSubscription.deleteMany({
        where: {
          userUuid,
          location,
          gender,
          type,
        },
      }),
    );
  }

  async getLaundryRoomSubscribers(
    location: Location,
    gender: Gender,
    type: MachineType,
  ) {
    return this.run(
      'getLaundryRoomSubscribers',
      this.databaseService.laundryRoomSubscription.findMany({
        where: {
          location,
          gender,
          type,
        },
      }),
    );
  }

  async deleteAllLaundryRoomSubscribers(
    location: Location,
    gender: Gender,
    type: MachineType,
  ) {
    return this.run(
      'deleteAllLaundryRoomSubscribers',
      this.databaseService.laundryRoomSubscription.deleteMany({
        where: {
          location,
          gender,
          type,
        },
      }),
    );
  }

  async deleteAllUserPushSubscriptionsInTx(
    userUuid: string,
    tx: PrismaTransaction,
  ): Promise<void> {
    await this.run(
      'deleteAllUserPushSubscriptionsInTx',
      tx.userPushSubscription.deleteMany({
        where: { userUuid },
      }),
    );
  }

  async deleteAllUserLaundryRoomSubscriptionsInTx(
    userUuid: string,
    tx: PrismaTransaction,
  ): Promise<void> {
    await this.run(
      'deleteAllUserLaundryRoomSubscriptionsInTx',
      tx.laundryRoomSubscription.deleteMany({
        where: { userUuid },
      }),
    );
  }
}
