import { ConflictException, HttpStatus, Injectable } from '@nestjs/common';
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
import { Trace } from '@gsainfoteam/nest-observability';
import { MachineRepository } from '@lib/database/repositories/machine.repository';

@Injectable()
@Trace()
export class NotificationService {
  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly webPushService: WebPushService,
    private readonly machineRepository: MachineRepository,
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
    await this.ensureLaundryRoomUnavailable(location, gender, type);

    const subscription =
      await this.notificationRepository.createLaundryRoomSubscription(
        userUuid,
        location,
        gender,
        type,
      );

    // A machine may have freed up between the check and the insert; its
    // availability notification could then have missed this subscription.
    if (
      (await this.machineRepository.countAvailableMachines(
        location,
        gender,
        type,
      )) > 0
    ) {
      await this.notificationRepository.deleteLaundryRoomSubscriptionsByUuids([
        subscription.uuid,
      ]);
      this.throwLaundryRoomAlreadyAvailable();
    }

    return subscription;
  }

  private async ensureLaundryRoomUnavailable(
    location: Location,
    gender: Gender,
    type: MachineType,
  ): Promise<void> {
    const count = await this.machineRepository.countAvailableMachines(
      location,
      gender,
      type,
    );
    if (count > 0) this.throwLaundryRoomAlreadyAvailable();
  }

  private throwLaundryRoomAlreadyAvailable(): never {
    throw new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: 'An available machine already exists in this laundry room.',
      errorCode: 'LAUNDRY_ROOM_ALREADY_AVAILABLE',
    });
  }

  async getUserLaundryRoomSubscriptions(userUuid: string) {
    return await this.notificationRepository.getUserLaundryRoomSubscriptions(
      userUuid,
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
      url: '/',
    };

    await this.webPushService.sendWebPushToUser(userUuid, payload);
  }

  async notifyMachineError(userUuid: string, machine: Machine): Promise<void> {
    const typeName = this.machineTypeName(machine.type);
    await this.webPushService.sendWebPushToUser(userUuid, {
      title: `${typeName} 오류 알림 🧺`,
      body: `${machine.location}동 ${machine.index}번 ${typeName}에 오류가 발생했습니다. 기기를 확인해 주세요.`,
      url: '/',
    });
  }

  async notifyMachineReregistered(
    userUuid: string,
    machine: Machine,
  ): Promise<void> {
    const typeName = this.machineTypeName(machine.type);
    await this.webPushService.sendWebPushToUser(userUuid, {
      title: `${typeName} 사용 종료 알림 🧺`,
      body: `${machine.location}동 ${machine.index}번 ${typeName}: 다른 사용자가 완료를 확인하고 기기를 등록했어요`,
      url: '/',
    });
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

    // Skip when the freed machine is disabled/deleted or got taken right away.
    const availableCount = await this.machineRepository.countAvailableMachines(
      location,
      gender,
      type,
    );
    if (availableCount === 0) return;

    const typeName = this.machineTypeName(type);
    const payload = {
      title: '빈 기기 발생 알림 🧺',
      body: `${location}동 ${gender === Gender.MALE ? '남성' : '여성'} 세탁실에 빈 ${typeName}가 생겼습니다!`,
      url: '/',
    };

    // One failed push must not block the others.
    const results = await Promise.allSettled(
      subscribers.map((sub) =>
        this.webPushService.sendWebPushToUser(sub.userUuid, payload),
      ),
    );

    // Delete only what was notified so failed sends and subscriptions created
    // meanwhile survive for the next availability event.
    await this.notificationRepository.deleteLaundryRoomSubscriptionsByUuids(
      subscribers
        .filter((_, i) => results[i].status === 'fulfilled')
        .map((sub) => sub.uuid),
    );
  }

  async notifyMachineOffline(machine: Machine): Promise<void> {
    const recipients =
      await this.notificationRepository.getAdminPushRecipients();
    const typeName = this.machineTypeName(machine.type);
    await Promise.all(
      recipients.map(({ uuid }) =>
        this.webPushService.sendWebPushToUser(uuid, {
          title: '기기 연결 끊김 알림',
          body: `${machine.location}동 ${machine.gender === Gender.MALE ? '남성' : '여성'} 세탁실 ${machine.index}번 ${typeName}의 연결이 끊겼습니다. 기기와 네트워크를 확인해 주세요.`,
          url: '/admin/machines',
        }),
      ),
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
