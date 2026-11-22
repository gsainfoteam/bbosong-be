import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StringValue } from 'ms';

// Regional servers from the official ThinQ Connect OpenAPI:
// https://smartsolution.developer.lge.com/ko/apiManage/thinq_connect
export const THINQ_API_SERVERS = [
  'https://api-kic.lgthinq.com',
  'https://api-aic.lgthinq.com',
  'https://api-eic.lgthinq.com',
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_ANDROID_CHANNEL_ID = 'default';
const DEFAULT_MACHINE_REGISTER_URL =
  'https://bbosong.gistory.me/machine-register';
const DEFAULT_MACHINE_POWER_RETENTION_DAYS = 30;
const DEFAULT_LIVE_UPDATE_TICK_INTERVAL_SECONDS = 180;
/** Lower bound keeps ticks clear of the 60s correction throttle. */
const MIN_LIVE_UPDATE_TICK_INTERVAL_SECONDS = 60;
const MAX_LIVE_UPDATE_TICK_INTERVAL_SECONDS = 3600;
const DEFAULT_THINQ_POLL_INTERVAL_SECONDS = 600;
const MIN_THINQ_POLL_INTERVAL_SECONDS = 300;
const MAX_THINQ_POLL_INTERVAL_SECONDS = 86_400;

/** Typed access to every environment variable the application reads. */
@Injectable()
export class BbosongConfigService {
  constructor(private readonly config: ConfigService) {}

  // Swagger / HTTP
  get swaggerUser(): string {
    return this.config.getOrThrow<string>('SWAGGER_USER');
  }
  get swaggerPassword(): string {
    return this.config.getOrThrow<string>('SWAGGER_PASSWORD');
  }
  get swaggerAuthUrl(): string {
    return this.config.getOrThrow<string>('SWAGGER_AUTH_URL');
  }
  get swaggerTokenUrl(): string {
    return this.config.getOrThrow<string>('SWAGGER_TOKEN_URL');
  }
  get apiUrl(): string {
    return this.config.getOrThrow<string>('API_URL');
  }
  get clientId(): string {
    return this.config.getOrThrow<string>('CLIENT_ID');
  }
  /** Comma-separated CORS origins, trimmed, empty entries dropped. */
  get corsOrigins(): string[] {
    return this.config
      .getOrThrow<string>('CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin !== '');
  }

  // Auth
  get userJwtSecret(): string {
    return this.config.getOrThrow<string>('USER_JWT_SECRET');
  }
  get userJwtExpire(): StringValue {
    return this.config.getOrThrow<StringValue>('USER_JWT_EXPIRE');
  }
  get userJwtAudience(): string {
    return this.config.getOrThrow<string>('USER_JWT_AUDIENCE');
  }
  get userJwtIssuer(): string {
    return this.config.getOrThrow<string>('USER_JWT_ISSUER');
  }
  get userRefreshTokenExpire(): StringValue {
    return this.config.getOrThrow<StringValue>('USER_REFRESH_TOKEN_EXPIRE');
  }
  get refreshTokenHmacSecret(): string {
    return this.config.getOrThrow<string>('REFRESH_TOKEN_HMAC_SECRET');
  }
  get policyApiUrl(): string {
    return this.config.getOrThrow<string>('POLICY_API_URL');
  }
  get serviceNameForPolicyVersion(): string {
    return this.config.getOrThrow<string>('SERVICE_NAME_FOR_POLICY_VERSION');
  }

  // Web Push
  get vapidSubject(): string {
    return this.config.getOrThrow<string>('VAPID_SUBJECT');
  }
  get vapidPublicKey(): string {
    return this.config.getOrThrow<string>('VAPID_PUBLIC_KEY');
  }
  get vapidPrivateKey(): string {
    return this.config.getOrThrow<string>('VAPID_PRIVATE_KEY');
  }

  // FCM / APNs / Slack
  get firebaseServiceAccountJson(): string | undefined {
    return this.config.get<string>('FIREBASE_SERVICE_ACCOUNT_JSON');
  }
  get fcmAndroidChannelId(): string {
    return (
      this.config.get<string>('FCM_ANDROID_CHANNEL_ID') ||
      DEFAULT_ANDROID_CHANNEL_ID
    );
  }
  get apnsKeyP8(): string | undefined {
    return this.config.get<string>('APNS_KEY_P8');
  }
  get apnsKeyId(): string | undefined {
    return this.config.get<string>('APNS_KEY_ID');
  }
  get apnsTeamId(): string | undefined {
    return this.config.get<string>('APNS_TEAM_ID');
  }
  get apnsBundleId(): string | undefined {
    return this.config.get<string>('APNS_BUNDLE_ID');
  }
  get slackWebhookUrl(): string | undefined {
    return this.config.get<string>('SLACK_WEBHOOK_URL')?.trim() || undefined;
  }
  /** Live Update tick cadence in ms; 0 disables ticks. */
  get liveUpdateTickIntervalMs(): number {
    const raw = this.config.get<string | number>(
      'LIVE_UPDATE_TICK_INTERVAL_SECONDS',
    );
    const seconds =
      raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
    if (seconds === 0) return 0;
    if (
      Number.isFinite(seconds) &&
      seconds >= MIN_LIVE_UPDATE_TICK_INTERVAL_SECONDS &&
      seconds <= MAX_LIVE_UPDATE_TICK_INTERVAL_SECONDS
    ) {
      return seconds * 1000;
    }
    return DEFAULT_LIVE_UPDATE_TICK_INTERVAL_SECONDS * 1000;
  }

  // ThinQ
  get thinqPat(): string | undefined {
    return this.config.get<string>('THINQ_PAT')?.trim();
  }
  get thinqCountryCode(): string | undefined {
    return this.config.get<string>('THINQ_COUNTRY_CODE')?.trim();
  }
  get thinqClientId(): string | undefined {
    return this.config.get<string>('THINQ_CLIENT_ID')?.trim();
  }
  get thinqApiKey(): string | undefined {
    return this.config.get<string>('THINQ_API_KEY')?.trim();
  }
  get thinqBaseUrl(): string {
    return this.config.get<string>('THINQ_BASE_URL') ?? THINQ_API_SERVERS[0];
  }
  /** ThinQ REST reconcile cadence in ms; invalid values fall back to the default. */
  get thinqPollIntervalMs(): number {
    const seconds = Number(
      this.config.get<string | number>('THINQ_POLL_INTERVAL_SECONDS') ??
        DEFAULT_THINQ_POLL_INTERVAL_SECONDS,
    );
    return Number.isFinite(seconds) &&
      seconds >= MIN_THINQ_POLL_INTERVAL_SECONDS &&
      seconds <= MAX_THINQ_POLL_INTERVAL_SECONDS
      ? seconds * 1000
      : DEFAULT_THINQ_POLL_INTERVAL_SECONDS * 1000;
  }

  /** User UUIDs from the comma-separated list; invalid entries are dropped. */
  get statsExcludedUserIds(): string[] {
    return (this.config.get<string>('STATS_EXCLUDED_USER_IDS') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => UUID_RE.test(id));
  }

  // Machine
  get matterSites(): { id: string; wsUrl: string }[] {
    return this.config
      .getOrThrow<string>('MATTER_SITES')
      .split(',')
      .map((site) => {
        const [id, ...urlParts] = site.split(':');
        return { id, wsUrl: urlParts.join(':') };
      });
  }
  get machineRegisterUrl(): string {
    return (
      this.config.get<string>('MACHINE_REGISTER_URL') ??
      DEFAULT_MACHINE_REGISTER_URL
    );
  }
  /** Retention in days; invalid or < 1 falls back to the default. */
  get machinePowerRetentionDays(): number {
    const days = Number(
      this.config.get<string | number>('MACHINE_POWER_RETENTION_DAYS') ??
        DEFAULT_MACHINE_POWER_RETENTION_DAYS,
    );
    return Number.isFinite(days) && days >= 1
      ? days
      : DEFAULT_MACHINE_POWER_RETENTION_DAYS;
  }
  get shlinkUrl(): string | undefined {
    return this.config.get<string>('SHLINK_URL');
  }
  get shlinkApiKey(): string | undefined {
    return this.config.get<string>('SHLINK_API_KEY');
  }
  get shlinkDomain(): string | undefined {
    return this.config.get<string>('SHLINK_DOMAIN');
  }
  get shlinkTag(): string | undefined {
    return this.config.get<string>('SHLINK_TAG');
  }
  get shlinkShortCodeLength(): number | undefined {
    const raw = this.config.get<string>('SHLINK_SHORT_CODE_LENGTH');
    return raw ? Number.parseInt(raw) : undefined;
  }
}
