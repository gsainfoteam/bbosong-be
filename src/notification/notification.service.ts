import { Injectable } from '@nestjs/common';
import { NotificationRepository } from '@lib/database/repositories/notification.repository';
import { SubscribeReqDto } from './dto/req/subscribe-req.dto';

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
    return this.notificationRepository.registerPush(
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

  async enableMachineNotification(userUuid: string, machineUuid: string) {
    return await this.notificationRepository.enableMachineNotification(
      userUuid,
      machineUuid,
    );
  }
}
