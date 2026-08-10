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

  // Mask sensitive user UUID for logging
  private maskUuid(uuid: string): string {
    return uuid.length > 8 ? `${uuid.slice(0, 8)}...` : uuid;
  }

  // Mask sensitive push endpoint URL for logging
  private maskEndpoint(endpoint: string): string {
    return endpoint.length > 20 ? `...${endpoint.slice(-15)}` : endpoint;
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
        `No active push subscriptions found for user: ${this.maskUuid(userUuid)}`,
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
        } catch (error: unknown) {
          const statusCode =
            error instanceof webpush.WebPushError
              ? error.statusCode
              : (error as { statusCode?: number })?.statusCode;

          const maskedEp = this.maskEndpoint(sub.endpoint);

          // Automatic cleanup of expired or unsubscribed endpoints (404 Not Found or 410 Gone)
          if (statusCode === 404 || statusCode === 410) {
            this.logger.warn(
              `Push endpoint expired or invalid, cleaning up: ${maskedEp}`,
            );
            try {
              await this.notificationRepository.unregisterPush(
                userUuid,
                sub.endpoint,
              );
            } catch (cleanupError: unknown) {
              const cleanupErrorMessage =
                cleanupError instanceof Error
                  ? (cleanupError.stack ?? cleanupError.message)
                  : typeof cleanupError === 'object' && cleanupError !== null
                    ? JSON.stringify(cleanupError)
                    : String(cleanupError);

              this.logger.error(
                `Failed to auto-cleanup expired push endpoint ${maskedEp}: ${cleanupErrorMessage}`,
              );
            }
          } else {
            const errorMessage =
              error instanceof Error
                ? (error.stack ?? error.message)
                : typeof error === 'object' && error !== null
                  ? JSON.stringify(error)
                  : String(error);

            this.logger.error(
              `Failed to send web push to endpoint ${maskedEp}: ${errorMessage}`,
            );
          }
        }
      }),
    );
  }
}
