import { Injectable } from '@nestjs/common';
import { NotificationRepository } from '@lib/database/repositories/notification.repository';
import { SubscribeReqDto } from './dto/req/subscribe-req.dto';
import { Gender, Location, MachineType } from 'generated/prisma/client';

@Injectable()
export class NotificationService {
  constructor(
    private readonly notificationRepository: NotificationRepository,
  ) {}

  async registerPush(
    userUuid: string,
    dto: SubscribeReqDto,
    userAgent?: string,
  ) {
    return await this.notificationRepository.registerPush(
      userUuid,
      dto.endpoint,
      dto.keys.p256dh,
      dto.keys.auth,
      userAgent,
    );
  }

  async unregisterPush(endpoint: string) {
    return await this.notificationRepository.unregisterPush(endpoint);
  }

  async createLaundryRoomSubscription(
    userUuid: string,
    location: Location,
    gender: Gender,
    type: MachineType,
  ) {
    return await this.notificationRepository.createLaundryRoomSubscription(
      userUuid,
      location,
      gender,
      type,
    );
  }

  async deleteLaundryRoomSubscription(
    userUuid: string,
    location: Location,
    gender: Gender,
    type: MachineType,
  ) {
    return await this.notificationRepository.deleteLaundryRoomSubscription(
      userUuid,
      location,
      gender,
      type,
    );
  }
}
