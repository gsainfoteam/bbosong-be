import { Loggable } from '@lib/logger';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BbosongConfigService } from '../../config/bbosong-config.service';
import { NotificationRepository } from '@lib/database/repositories/notification.repository';
import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import {
  FirebaseMessagingError,
  Message,
  Messaging,
  getMessaging,
} from 'firebase-admin/messaging';
import { formatError } from '../../common/utils/format-error.util';
import { PushPayload } from '../types/push-payload.type';

const FIREBASE_APP_NAME = 'bbosong-fcm';
const DEFAULT_ANDROID_CHANNEL_ID = 'default';

/** FCM error codes that mean the registration token can never work again. */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

@Loggable()
@Injectable()
export class FcmService implements OnModuleInit {
  private readonly logger = new Logger(FcmService.name);
  private messaging: Messaging | null = null;

  constructor(
    private readonly configService: BbosongConfigService,
    private readonly notificationRepository: NotificationRepository,
  ) {}

  /**
   * FCM is optional so environments without Firebase credentials keep working
   * (Web Push only); native devices are simply skipped there.
   */
  onModuleInit() {
    const raw = this.configService.firebaseServiceAccountJson;
    if (!raw?.trim()) {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT_JSON is not set; FCM push to native devices is disabled.',
      );
      return;
    }
    const app: App =
      getApps().find((a) => a.name === FIREBASE_APP_NAME) ??
      initializeApp(
        { credential: cert(this.parseServiceAccount(raw)) },
        FIREBASE_APP_NAME,
      );
    this.messaging = getMessaging(app);
  }

  /** Accepts the service-account JSON as-is or base64-encoded. */
  private parseServiceAccount(raw: string): Record<string, unknown> {
    const text = raw.trim().startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8');
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Never echo the value: it is a credential.
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_JSON must be a service-account JSON or its base64 encoding.',
      );
    }
  }

  private maskToken(token: string): string {
    return token.length > 12 ? `...${token.slice(-8)}` : token;
  }

  /** FCM data values must be strings; reserved keys are not overridable. */
  buildMessage(token: string, payload: PushPayload): Message {
    const data: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload.data ?? {})) {
      if (value === undefined || value === null) continue;
      data[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    if (payload.url !== undefined) data.url = payload.url;
    if (payload.icon !== undefined) data.icon = payload.icon;

    return {
      token,
      notification: { title: payload.title, body: payload.body },
      data,
      android: {
        // Time-sensitive laundry alerts should wake the device during Doze.
        priority: 'high',
        notification: {
          channelId:
            this.configService.fcmAndroidChannelId ||
            DEFAULT_ANDROID_CHANNEL_ID,
          sound: 'default',
        },
      },
      apns: {
        headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
        payload: { aps: { sound: 'default' } },
      },
    };
  }

  private isDeadToken(error: unknown): boolean {
    const { code, message } = error as FirebaseMessagingError;
    if (DEAD_TOKEN_CODES.has(code)) return true;
    // FCM reports a malformed token as a generic INVALID_ARGUMENT; only treat
    // it as dead when the message names the token, not for payload mistakes.
    return (
      code === 'messaging/invalid-argument' &&
      /registration token/i.test(message ?? '')
    );
  }

  /** Data-only message: the app builds and updates the Live Update itself. */
  buildLiveUpdateMessage(token: string, data: Record<string, string>): Message {
    return { token, data, android: { priority: 'high' } };
  }

  // Send an FCM notification to all native devices of a user.
  // Resolves true only if at least one device actually accepted the push.
  // `skipLiveUpdateDevices` leaves out Android devices that show the same
  // event as a Live Update (they receive it via sendLiveUpdateToUser).
  async sendFcmToUser(
    userUuid: string,
    payload: PushPayload,
    options: { skipLiveUpdateDevices?: boolean } = {},
  ): Promise<boolean> {
    if (!this.messaging) return false;

    const devices = (
      await this.notificationRepository.getUserNativePushDevices(userUuid)
    ).filter(
      (device) => !(options.skipLiveUpdateDevices && device.supportsLiveUpdate),
    );
    const results = await this.deliver(userUuid, devices, (token) =>
      this.buildMessage(token, payload),
    );
    return results.includes('sent');
  }

  /**
   * Sends a Live Update data message to the Android devices of a user that
   * opted in. Returns how many devices accepted it and how many could not be
   * reached (retryable); dead tokens count as neither.
   */
  async sendLiveUpdateToUser(
    userUuid: string,
    data: Record<string, string>,
  ): Promise<{ sent: number; failed: number }> {
    if (!this.messaging) return { sent: 0, failed: 0 };
    const devices =
      await this.notificationRepository.getUserLiveUpdateDevices(userUuid);
    const results = await this.deliver(userUuid, devices, (token) =>
      this.buildLiveUpdateMessage(token, data),
    );
    return {
      sent: results.filter((r) => r === 'sent').length,
      failed: results.filter((r) => r === 'failed').length,
    };
  }

  private async deliver(
    userUuid: string,
    devices: { uuid: string; fcmToken: string | null }[],
    build: (token: string) => Message,
  ): Promise<('sent' | 'dead' | 'failed' | 'skipped')[]> {
    const messaging = this.messaging;
    if (!messaging) return [];

    return await Promise.all(
      devices.map(async (device) => {
        const token = device.fcmToken;
        if (!token) return 'skipped' as const;
        const maskedToken = this.maskToken(token);

        try {
          await messaging.send(build(token));
        } catch (error: unknown) {
          if (this.isDeadToken(error)) {
            this.logger.warn(
              `FCM token unregistered or invalid, cleaning up: ${maskedToken}`,
            );
            try {
              await this.notificationRepository.unregisterNativePush(
                userUuid,
                token,
              );
            } catch (cleanupError: unknown) {
              this.logger.error(
                `Failed to auto-cleanup invalid FCM token ${maskedToken}: ${formatError(cleanupError)}`,
              );
            }
            return 'dead' as const;
          }
          this.logger.error(
            `Failed to send FCM push to token ${maskedToken}: ${formatError(error)}`,
          );
          return 'failed' as const;
        }

        try {
          await this.notificationRepository.markPushSubscriptionActivated(
            device.uuid,
            new Date(),
          );
        } catch (activationError: unknown) {
          this.logger.error(
            `Failed to record successful FCM push for token ${maskedToken}: ${formatError(activationError)}`,
          );
        }
        return 'sent' as const;
      }),
    );
  }
}
