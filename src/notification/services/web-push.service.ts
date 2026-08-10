import { Loggable } from '@lib/logger';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationRepository } from '@lib/database/repositories/notification.repository';
import * as webpush from 'web-push';

export interface WebPushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  data?: Record<string, unknown>;
}

@Loggable()
@Injectable()
export class WebPushService implements OnModuleInit {
  private readonly logger = new Logger(WebPushService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationRepository: NotificationRepository,
  ) {}

  onModuleInit() {
    const subject = this.configService.getOrThrow<string>('VAPID_SUBJECT');
    const publicKey = this.configService.getOrThrow<string>('VAPID_PUBLIC_KEY');
    const privateKey =
      this.configService.getOrThrow<string>('VAPID_PRIVATE_KEY');

    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  // Send Web Push notification to all active devices of a user
  async sendWebPushToUser(
    userUuid: string,
    payload: WebPushPayload,
  ): Promise<void> {
    const subscriptions =
      await this.notificationRepository.getUserPushSubscriptions(userUuid);

    if (subscriptions.length === 0) {
      this.logger.debug(
        `No active push subscriptions found for user: ${userUuid}`,
      );
      return;
    }

    const pushPayload = JSON.stringify(payload);

    await Promise.all(
      subscriptions.map(async (sub) => {
        const pushSubscription: webpush.PushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        try {
          await webpush.sendNotification(pushSubscription, pushPayload);
        } catch (error) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            this.logger.warn(
              `Push endpoint expired or invalid, cleaning up: ${sub.endpoint}`,
            );
            await this.notificationRepository.unregisterPush(
              userUuid,
              sub.endpoint,
            );
          } else {
            this.logger.error(
              `Failed to send web push to endpoint ${sub.endpoint}: ${error}`,
            );
          }
        }
      }),
    );
  }
}
