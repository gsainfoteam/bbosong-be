import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { NotificationRepository } from '@lib/database/repositories/notification.repository';
import { SubscribeReqDto } from './dto/req/subscribe-req.dto';
import {
  Gender,
  Location,
  Machine,
  MachineType,
} from 'generated/prisma/client';
import { WebPushService } from './services/web-push.service';
import { FcmService } from './services/fcm.service';
import { SlackWebhookService } from './services/slack-webhook.service';
import { ConfigService } from '@nestjs/config';
import { getStatsExcludedUserUuids } from '../common/utils/stats-exclusion.util';
import { PushPayload } from './types/push-payload.type';
import { RegisterNativePushReqDto } from './dto/req/register-native-push-req.dto';
import { PrismaTransaction } from '@lib/database';
import { Trace } from '@gsainfoteam/nest-observability';
import { MachineRepository } from '@lib/database/repositories/machine.repository';

const MAX_STATS_DAYS = 90;

@Injectable()
@Trace()
export class NotificationService {
  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly webPushService: WebPushService,
    private readonly fcmService: FcmService,
    private readonly machineRepository: MachineRepository,
    private readonly slackWebhookService: SlackWebhookService,
    private readonly configService?: ConfigService,
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

  async registerNativePush(
    userUuid: string,
    dto: RegisterNativePushReqDto,
    userAgent?: string,
  ) {
    return await this.notificationRepository.registerNativePush(
      userUuid,
      dto.platform,
      dto.token,
      userAgent,
      dto.platform === 'ANDROID' && dto.supportsLiveUpdate === true,
    );
  }

  async unregisterNativePush(userUuid: string, token: string) {
    return await this.notificationRepository.unregisterNativePush(
      userUuid,
      token,
    );
  }

  /**
   * Fans a message out to every device of the user over Web Push and FCM.
   * A failing channel never blocks the other. Resolves true only if at least
   * one device accepted the push.
   */
  private async sendPushToUser(
    userUuid: string,
    payload: PushPayload,
    options: { skipLiveUpdateDevices?: boolean } = {},
  ): Promise<boolean> {
    const results = await Promise.allSettled([
      this.webPushService.sendWebPushToUser(userUuid, payload),
      this.fcmService.sendFcmToUser(userUuid, payload, options),
    ]);
    const failure = results.find((r) => r.status === 'rejected');
    const delivered = results.some(
      (r) => r.status === 'fulfilled' && r.value === true,
    );
    // Surface an error only when nothing got through, so callers that retry
    // later (e.g. laundry-room subscriptions) keep their state.
    if (!delivered && failure) throw failure.reason;
    return delivered;
  }

  async createLaundryRoomSubscription(
    userUuid: string,
    location: Location,
    gender: Gender,
    type: MachineType,
  ) {
    await this.ensureLaundryRoomUnavailable(location, gender, type);

    const { subscription, logUuid } =
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
      await this.notificationRepository.rollbackLaundryRoomSubscription(
        subscription.uuid,
        logUuid,
      );
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
    const payload: PushPayload = {
      title: `${typeName} 완료 알림 🧺`,
      body: `${machine.location}동 ${machine.index}번 ${typeName} 작동이 완료되었습니다. 빨래를 수거해 주세요!`,
      url: '/',
      data: { type: 'machine-completion', machineUuid: machine.uuid },
    };

    // Live Update devices get the END state as a data message instead.
    await this.sendPushToUser(userUuid, payload, {
      skipLiveUpdateDevices: true,
    });
  }

  async notifyMachineError(userUuid: string, machine: Machine): Promise<void> {
    const typeName = this.machineTypeName(machine.type);
    await this.sendPushToUser(
      userUuid,
      {
        title: `${typeName} 오류 알림 🧺`,
        body: `${machine.location}동 ${machine.index}번 ${typeName}에 오류가 발생했습니다. 기기를 확인해 주세요.`,
        url: '/',
        data: { type: 'machine-error', machineUuid: machine.uuid },
      },
      { skipLiveUpdateDevices: true },
    );
  }

  async notifyMachineReregistered(
    userUuid: string,
    machine: Machine,
  ): Promise<void> {
    const typeName = this.machineTypeName(machine.type);
    await this.sendPushToUser(
      userUuid,
      {
        title: `${typeName} 사용 종료 알림 🧺`,
        body: `${machine.location}동 ${machine.index}번 ${typeName}: 다른 사용자가 완료를 확인하고 기기를 등록했어요`,
        url: '/',
        data: { type: 'machine-reregistered', machineUuid: machine.uuid },
      },
      { skipLiveUpdateDevices: true },
    );
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
    const payload: PushPayload = {
      title: '빈 기기 발생 알림 🧺',
      body: `${location}동 ${gender === Gender.MALE ? '남성' : '여성'} 세탁실에 빈 ${typeName}가 생겼습니다!`,
      url: '/',
      // Lets the client identify the laundry-room subscription the server is
      // about to delete and sync its toggle.
      data: {
        type: 'laundry-room-available',
        location,
        gender,
        machineType: type,
      },
    };

    // One failed push must not block the others. Each send records its own
    // completion time so a slow batch cannot shift earlier sends to a later day.
    const results = await Promise.allSettled(
      subscribers.map(async (sub) => {
        const delivered = await this.sendPushToUser(sub.userUuid, payload);
        return delivered ? new Date() : null;
      }),
    );

    // Log and delete only what was actually delivered so failed sends and
    // subscriptions created meanwhile survive for the next availability event.
    const notified = subscribers.flatMap((sub, i) => {
      const result = results[i];
      return result.status === 'fulfilled' && result.value
        ? [{ ...sub, notifiedAt: result.value }]
        : [];
    });
    await this.notificationRepository.completeLaundryRoomNotifications(
      notified,
    );
  }

  async getDailyLaundryRoomNotificationStats(from: string, to: string) {
    const days =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000 +
      1;
    if (!(days >= 1)) {
      throw new BadRequestException('`from` must not be after `to`.');
    }
    if (days > MAX_STATS_DAYS) {
      throw new BadRequestException(
        `The range must not exceed ${MAX_STATS_DAYS} days.`,
      );
    }
    return await this.notificationRepository.countDailyLaundryRoomStats(
      from,
      to,
      getStatsExcludedUserUuids(this.configService),
    );
  }

  /** Admin connectivity alerts go to Slack only; no push is sent. */
  async notifyMachineOffline(machine: Machine): Promise<void> {
    await this.slackWebhookService.send(
      `:warning: *기기 연결 끊김*\n${this.machineLabel(machine)}의 연결이 끊겼습니다. 기기와 네트워크를 확인해 주세요.`,
    );
  }

  async notifyMachineOnline(
    machine: Machine,
    downtimeMs: number,
  ): Promise<void> {
    await this.slackWebhookService.send(
      `:white_check_mark: *기기 연결 복구*\n${this.machineLabel(machine)}의 연결이 복구되었습니다. (끊긴 시간: ${this.formatDuration(downtimeMs)})`,
    );
  }

  private machineLabel(machine: Machine): string {
    return `${machine.location}동 ${machine.gender === Gender.MALE ? '남성' : '여성'} 세탁실 ${machine.index}번 ${this.machineTypeName(machine.type)}`;
  }

  private formatDuration(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    const parts: string[] = [];
    if (h) parts.push(`${h}시간`);
    if (m) parts.push(`${m}분`);
    if (sec || parts.length === 0) parts.push(`${sec}초`);
    return parts.join(' ');
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
