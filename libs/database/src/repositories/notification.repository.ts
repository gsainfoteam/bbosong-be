import { Loggable } from '@lib/logger';
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@lib/database/database.service';
import { Location, Gender, MachineType } from 'generated/prisma/client';

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
    return this.databaseService.userPushSubscription.upsert({
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
    });
  }

  async unregisterPush(endpoint: string) {
    return this.databaseService.userPushSubscription.deleteMany({
      where: { endpoint },
    });
  }

  async enableMachineNotification(userUuid: string, machineUuid: string) {
    return this.databaseService.usingMachine.updateMany({
      where: {
        machineUuid,
        OR: [{ userUuid: null }, { userUuid: userUuid }],
      },
      data: {
        userUuid,
        notifyOnCompletion: true,
      },
    });
  }

  async disableMachineNotification(userUuid: string, machineUuid: string) {
    return this.databaseService.usingMachine.updateMany({
      where: {
        machineUuid,
        userUuid,
      },
      data: {
        notifyOnCompletion: false,
      },
    });
  }

  async createLaundryRoomSubscription(
    userUuid: string,
    location: Location,
    gender: Gender,
    type: MachineType,
  ) {
    return this.databaseService.laundryRoomSubscription.upsert({
      where: {
        userUuid_location_gender_type: { userUuid, location, gender, type },
      },
      create: { userUuid, location, gender, type },
      update: {
        createdAt: new Date(),
      },
    });
  }

  async deleteLaundryRoomSubscription(
    userUuid: string,
    location: Location,
    gender: Gender,
    type: MachineType,
  ) {
    return this.databaseService.laundryRoomSubscription.deleteMany({
      where: {
        userUuid,
        location,
        gender,
        type,
      },
    });
  }
}
