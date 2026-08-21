import { Injectable } from '@nestjs/common';
import { NotificationRepository } from '@lib/database/repositories/notification.repository';
import { SubscribeReqDto } from './dto/req/subscribe-req.dto';
import {
  Gender,
  Location,
  Machine,
  MachineType,
} from 'generated/prisma/client';
import { WebPushService } from './services/web-push.service';
import { PrismaTransaction } from '@lib/database';

@Injectable()
export class NotificationService {
  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly webPushService: WebPushService,
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

  async unregisterPush(userUuid: string, endpoint: string) {
    return await this.notificationRepository.unregisterPush(userUuid, endpoint);
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

  private machineTypeName(type: MachineType): string {
    return type === MachineType.WASHER ? '세탁기' : '건조기';
  }

  async notifyMachineCompletion(
    userUuid: string,
    machine: Machine,
  ): Promise<void> {
    const typeName = this.machineTypeName(machine.type);
    const payload = {
      title: `${typeName} 완료 알림 🧺`,
      body: `${machine.location}동 ${machine.index}번 ${typeName} 작동이 완료되었습니다. 빨래를 수거해 주세요!`,
      url: '/machine',
    };

    await this.webPushService.sendWebPushToUser(userUuid, payload);
  }

  async notifyLaundryRoomAvailable(
    location: Location,
    gender: Gender,
    type: MachineType,
  ): Promise<void> {
    const subscribers =
      await this.notificationRepository.getLaundryRoomSubscribers(
        location,
        gender,
        type,
      );

    if (subscribers.length === 0) return;

    const typeName = this.machineTypeName(type);
    const payload = {
      title: '빈 기기 발생 알림 🧺',
      body: `${location}동 ${gender === Gender.MALE ? '남성' : '여성'} 세탁실에 빈 ${typeName}가 생겼습니다!`,
      url: '/machine',
    };

    await Promise.all(
      subscribers.map((sub) =>
        this.webPushService.sendWebPushToUser(sub.userUuid, payload),
      ),
    );

    await this.notificationRepository.deleteAllLaundryRoomSubscribers(
      location,
      gender,
      type,
    );
  }

  async deleteAllUserPushSubscriptionsInTx(
    userUuid: string,
    tx: PrismaTransaction,
  ) {
    return this.notificationRepository.deleteAllUserPushSubscriptionsInTx(
      userUuid,
      tx,
    );
  }

  async deleteAllUserLaundryRoomSubscriptionsInTx(
    userUuid: string,
    tx: PrismaTransaction,
  ) {
    return this.notificationRepository.deleteAllUserLaundryRoomSubscriptionsInTx(
      userUuid,
      tx,
    );
  }
}
