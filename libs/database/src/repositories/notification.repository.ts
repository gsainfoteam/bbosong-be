import { Loggable } from '@lib/logger';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '@lib/database/database.service';

import {
  Location,
  Gender,
  MachineType,
  Prisma,
  PushPlatform,
  Role,
} from 'generated/prisma/client';
import { PrismaTransaction } from '@lib/database/types';
import { Trace } from '@gsainfoteam/nest-observability';

@Loggable()
@Injectable()
@Trace()
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

  /** Upserts a Web Push subscription; an existing endpoint moves to `userUuid`. */
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
          platform: PushPlatform.WEB,
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

  /**
   * Upserts a native FCM device by token. A token already registered to
   * another account moves to `userUuid`, so a shared device never keeps
   * notifying the previous account.
   */
  async registerNativePush(
    userUuid: string,
    platform: Exclude<PushPlatform, 'WEB'>,
    fcmToken: string,
    userAgent?: string,
  ) {
    return this.run(
      'registerNativePush',
      this.databaseService.userPushSubscription.upsert({
        where: { fcmToken },
        create: { userUuid, platform, fcmToken, userAgent },
        update: { userUuid, platform, userAgent },
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

  async unregisterNativePush(userUuid: string, fcmToken: string) {
    return this.run(
      'unregisterNativePush',
      this.databaseService.userPushSubscription.deleteMany({
        where: { fcmToken, userUuid },
      }),
    );
  }

  async getUserWebPushSubscriptions(userUuid: string) {
    return this.run(
      'getUserWebPushSubscriptions',
      this.databaseService.userPushSubscription.findMany({
        where: { userUuid, platform: PushPlatform.WEB },
      }),
    );
  }

  async getUserNativePushDevices(userUuid: string) {
    return this.run(
      'getUserNativePushDevices',
      this.databaseService.userPushSubscription.findMany({
        where: {
          userUuid,
          platform: { in: [PushPlatform.IOS, PushPlatform.ANDROID] },
        },
      }),
    );
  }

  async markPushSubscriptionActivated(uuid: string, activatedAt: Date) {
    return this.run(
      'markPushSubscriptionActivated',
      this.databaseService.userPushSubscription.updateMany({
        where: {
          uuid,
          OR: [
            { lastActivatedAt: null },
            { lastActivatedAt: { lt: activatedAt } },
          ],
        },
        data: { lastActivatedAt: activatedAt },
      }),
    );
  }

  async getAdminPushRecipients() {
    return this.run(
      'getAdminPushRecipients',
      this.databaseService.user.findMany({
        where: {
          deletedAt: null,
          role: Role.ADMIN,
          pushSubscriptions: { some: {} },
        },
        select: { uuid: true },
      }),
    );
  }

  /**
   * Upserts the subscription and records the request in the log atomically.
   * `subscribedAt` is written explicitly (UTC) instead of relying on the
   * column default, which would follow the DB session time zone.
   */
  async createLaundryRoomSubscription(
    userUuid: string,
    location: Location,
    gender: Gender,
    type: MachineType,
  ) {
    const now = new Date();
    const [subscription, log] = await this.run(
      'createLaundryRoomSubscription',
      this.databaseService.$transaction([
        this.databaseService.laundryRoomSubscription.upsert({
          where: {
            userUuid_location_gender_type: { userUuid, location, gender, type },
          },
          create: { userUuid, location, gender, type },
          update: {
            createdAt: now,
          },
        }),
        this.databaseService.laundryRoomSubscriptionLog.create({
          data: { userUuid, location, gender, type, subscribedAt: now },
        }),
      ]),
    );
    return { subscription, logUuid: log.uuid };
  }

  /** Undoes `createLaundryRoomSubscription`, subscription and log together. */
  async rollbackLaundryRoomSubscription(
    subscriptionUuid: string,
    logUuid: string,
  ) {
    return this.run(
      'rollbackLaundryRoomSubscription',
      this.databaseService.$transaction([
        this.databaseService.laundryRoomSubscription.deleteMany({
          where: { uuid: subscriptionUuid },
        }),
        this.databaseService.laundryRoomSubscriptionLog.deleteMany({
          where: { uuid: logUuid },
        }),
      ]),
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

  async getUserLaundryRoomSubscriptions(userUuid: string) {
    return this.run(
      'getUserLaundryRoomSubscriptions',
      this.databaseService.laundryRoomSubscription.findMany({
        where: { userUuid },
        orderBy: { createdAt: 'desc' },
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

  /**
   * Records each notified subscription in the log and removes it atomically,
   * so a subscription is never deleted without leaving a history row.
   */
  async completeLaundryRoomNotifications(
    subscriptions: {
      uuid: string;
      userUuid: string;
      location: Location;
      gender: Gender;
      type: MachineType;
      createdAt: Date;
      notifiedAt: Date;
    }[],
  ) {
    if (subscriptions.length === 0) return;
    return this.run(
      'completeLaundryRoomNotifications',
      this.databaseService.$transaction([
        this.databaseService.laundryRoomNotificationLog.createMany({
          data: subscriptions.map((sub) => ({
            userUuid: sub.userUuid,
            location: sub.location,
            gender: sub.gender,
            type: sub.type,
            subscribedAt: sub.createdAt,
            notifiedAt: sub.notifiedAt,
          })),
        }),
        this.databaseService.laundryRoomSubscription.deleteMany({
          where: { uuid: { in: subscriptions.map((sub) => sub.uuid) } },
        }),
      ]),
    );
  }

  /** Per-KST-day subscription/notification counts for `[from, to]`. */
  async countDailyLaundryRoomStats(from: string, to: string) {
    return this.run(
      'countDailyLaundryRoomStats',
      this.databaseService.$queryRaw<
        {
          date: string;
          subscriptionCount: number;
          subscriptionUserCount: number;
          notificationCount: number;
          notificationUserCount: number;
        }[]
      >`
        WITH days AS (
          SELECT generate_series(${from}::date, ${to}::date, '1 day'::interval)::date AS day
        ),
        sub AS (
          SELECT
            ((subscribed_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date AS day,
            COUNT(*)::int AS cnt,
            COUNT(DISTINCT user_uuid)::int AS users
          FROM laundry_room_subscription_log
          WHERE subscribed_at >= ((${from}::date)::timestamp AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
            AND subscribed_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
          GROUP BY 1
        ),
        notif AS (
          SELECT
            ((notified_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date AS day,
            COUNT(*)::int AS cnt,
            COUNT(DISTINCT user_uuid)::int AS users
          FROM laundry_room_notification_log
          WHERE notified_at >= ((${from}::date)::timestamp AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
            AND notified_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC'
          GROUP BY 1
        )
        SELECT
          to_char(d.day, 'YYYY-MM-DD') AS "date",
          COALESCE(s.cnt, 0) AS "subscriptionCount",
          COALESCE(s.users, 0) AS "subscriptionUserCount",
          COALESCE(n.cnt, 0) AS "notificationCount",
          COALESCE(n.users, 0) AS "notificationUserCount"
        FROM days d
        LEFT JOIN sub s ON s.day = d.day
        LEFT JOIN notif n ON n.day = d.day
        ORDER BY d.day
      `,
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
