import { Loggable } from '@lib/logger';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KeyObject, createPrivateKey, sign } from 'node:crypto';
import { LiveActivityEnvironment } from 'generated/prisma/client';
import { formatError } from '../../common/utils/format-error.util';
import { LiveActivityContentState } from '../types/live-activity.type';
import { ApnsHttpClient } from './apns-http-client';

const APNS_HOSTS: Record<LiveActivityEnvironment, string> = {
  SANDBOX: 'api.sandbox.push.apple.com',
  PRODUCTION: 'api.push.apple.com',
};

/** Apple rejects provider tokens older than 60 min or refreshed under 20 min. */
const JWT_TTL_MS = 40 * 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;
/** Let APNs hold the end event for an offline device for this long. */
const END_EXPIRATION_SECONDS = 60 * 60;

/** APNs reasons meaning the token can never receive pushes again. */
const DEAD_TOKEN_REASONS = new Set([
  'BadDeviceToken',
  'DeviceTokenNotForTopic',
]);

export type ApnsSendResult = 'sent' | 'dead-token' | 'failed' | 'disabled';

interface ApnsConfig {
  key: KeyObject;
  keyId: string;
  teamId: string;
  bundleId: string;
}

@Loggable()
@Injectable()
export class ApnsService implements OnModuleInit {
  private readonly logger = new Logger(ApnsService.name);
  private config: ApnsConfig | null = null;
  private jwt: { value: string; issuedAt: number } | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpClient: ApnsHttpClient,
  ) {}

  /**
   * APNs is optional so environments without credentials keep working;
   * Live Activity pushes are simply skipped there.
   */
  onModuleInit() {
    const raw = this.configService.get<string>('APNS_KEY_P8');
    const keyId = this.configService.get<string>('APNS_KEY_ID');
    const teamId = this.configService.get<string>('APNS_TEAM_ID');
    const bundleId = this.configService.get<string>('APNS_BUNDLE_ID');
    if (!raw?.trim() || !keyId || !teamId || !bundleId) {
      this.logger.warn(
        'APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID or APNS_BUNDLE_ID is not set; Live Activity push is disabled.',
      );
      return;
    }
    this.config = {
      key: this.parseKey(raw),
      keyId: keyId.trim(),
      teamId: teamId.trim(),
      bundleId: bundleId.trim(),
    };
  }

  isEnabled(): boolean {
    return this.config !== null;
  }

  /** Accepts the .p8 PEM as-is, with escaped "\n" sequences, or base64-encoded. */
  private parseKey(raw: string): KeyObject {
    const trimmed = raw.trim();
    const pem = trimmed.startsWith('-----')
      ? trimmed.replace(/\\n/g, '\n')
      : Buffer.from(trimmed, 'base64').toString('utf8');
    try {
      return createPrivateKey(pem);
    } catch {
      // Never echo the value: it is a credential.
      throw new Error(
        'APNS_KEY_P8 must be an APNs .p8 private key (PEM) or its base64 encoding.',
      );
    }
  }

  private base64Url(input: Buffer | string): string {
    return Buffer.from(input).toString('base64url');
  }

  private getJwt(config: ApnsConfig, now: number): string {
    if (this.jwt && now - this.jwt.issuedAt < JWT_TTL_MS) return this.jwt.value;
    const header = this.base64Url(
      JSON.stringify({ alg: 'ES256', kid: config.keyId }),
    );
    const claims = this.base64Url(
      JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) }),
    );
    const signingInput = `${header}.${claims}`;
    // APNs expects the raw r||s signature (JWS), not DER.
    const signature = sign('sha256', Buffer.from(signingInput), {
      key: config.key,
      dsaEncoding: 'ieee-p1363',
    });
    const value = `${signingInput}.${this.base64Url(signature)}`;
    this.jwt = { value, issuedAt: now };
    return value;
  }

  private maskToken(token: string): string {
    return token.length > 12 ? `...${token.slice(-8)}` : token;
  }

  /**
   * Ends a Live Activity. No `dismissal-date` is sent on purpose: iOS then
   * keeps the finished activity on the Lock Screen (up to 4 hours) so the user
   * can see it is done and dismiss it themselves after picking up the laundry.
   */
  async sendLiveActivityEnd(
    token: { pushToken: string; environment: LiveActivityEnvironment },
    contentState: LiveActivityContentState,
    now: Date = new Date(),
  ): Promise<ApnsSendResult> {
    const seconds = Math.floor(now.getTime() / 1000);
    return this.send(
      token,
      {
        aps: {
          timestamp: seconds,
          event: 'end',
          'content-state': contentState,
        },
      },
      { priority: '10', expiration: seconds + END_EXPIRATION_SECONDS },
    );
  }

  private async send(
    token: { pushToken: string; environment: LiveActivityEnvironment },
    payload: Record<string, unknown>,
    options: { priority: '5' | '10'; expiration: number },
  ): Promise<ApnsSendResult> {
    const config = this.config;
    if (!config) return 'disabled';

    const masked = this.maskToken(token.pushToken);
    const host = APNS_HOSTS[token.environment];
    const body = JSON.stringify(payload);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.httpClient.post(
          host,
          `/3/device/${token.pushToken}`,
          {
            authorization: `bearer ${this.getJwt(config, Date.now())}`,
            'apns-push-type': 'liveactivity',
            'apns-topic': `${config.bundleId}.push-type.liveactivity`,
            'apns-priority': options.priority,
            'apns-expiration': String(options.expiration),
            'content-type': 'application/json',
          },
          body,
        );
        if (response.status === 200) return 'sent';

        const reason = this.parseReason(response.body);
        if (
          response.status === 410 ||
          (response.status === 400 && DEAD_TOKEN_REASONS.has(reason))
        ) {
          this.logger.warn(
            `APNs rejected Live Activity token ${masked} (${response.status} ${reason}); it will be removed.`,
          );
          return 'dead-token';
        }
        if (response.status === 403 && reason === 'ExpiredProviderToken') {
          this.jwt = null;
          continue;
        }
        if (response.status === 429 || response.status >= 500) {
          this.logger.warn(
            `APNs temporarily failed for token ${masked} (${response.status} ${reason}), attempt ${attempt}/${MAX_ATTEMPTS}`,
          );
          await this.delay(RETRY_DELAY_MS * attempt);
          continue;
        }
        // Remaining 4xx are configuration or payload problems; retrying is futile.
        this.logger.error(
          `APNs rejected Live Activity push for token ${masked}: ${response.status} ${reason}`,
        );
        return 'failed';
      } catch (error: unknown) {
        this.logger.warn(
          `APNs request failed for token ${masked}, attempt ${attempt}/${MAX_ATTEMPTS}: ${formatError(error)}`,
        );
        if (attempt < MAX_ATTEMPTS) await this.delay(RETRY_DELAY_MS * attempt);
      }
    }
    return 'failed';
  }

  private parseReason(body: string): string {
    try {
      const parsed = JSON.parse(body) as { reason?: unknown };
      return typeof parsed.reason === 'string' ? parsed.reason : 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
