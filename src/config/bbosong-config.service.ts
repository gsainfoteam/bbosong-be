import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StringValue } from 'ms';

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
  get corsOrigins(): string {
    return this.config.getOrThrow<string>('CORS_ORIGINS');
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
  get fcmAndroidChannelId(): string | undefined {
    return this.config.get<string>('FCM_ANDROID_CHANNEL_ID');
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
    return this.config.get<string>('SLACK_WEBHOOK_URL');
  }
  get liveUpdateTickIntervalSeconds(): string | number | undefined {
    return this.config.get<string | number>(
      'LIVE_UPDATE_TICK_INTERVAL_SECONDS',
    );
  }

  // ThinQ
  get thinqPat(): string | undefined {
    return this.config.get<string>('THINQ_PAT');
  }
  get thinqCountryCode(): string | undefined {
    return this.config.get<string>('THINQ_COUNTRY_CODE');
  }
  get thinqClientId(): string | undefined {
    return this.config.get<string>('THINQ_CLIENT_ID');
  }
  get thinqApiKey(): string | undefined {
    return this.config.get<string>('THINQ_API_KEY');
  }
  get thinqBaseUrl(): string | undefined {
    return this.config.get<string>('THINQ_BASE_URL');
  }
  get thinqPollIntervalSeconds(): string | number | undefined {
    return this.config.get<string | number>('THINQ_POLL_INTERVAL_SECONDS');
  }

  get statsExcludedUserIds(): string | undefined {
    return this.config.get<string>('STATS_EXCLUDED_USER_IDS');
  }

  // Machine
  get matterSites(): string {
    return this.config.getOrThrow<string>('MATTER_SITES');
  }
  get machineRegisterUrl(): string | undefined {
    return this.config.get<string>('MACHINE_REGISTER_URL');
  }
  get machinePowerRetentionDays(): string | number | undefined {
    return this.config.get<string | number>('MACHINE_POWER_RETENTION_DAYS');
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
  get shlinkShortCodeLength(): string | undefined {
    return this.config.get<string>('SHLINK_SHORT_CODE_LENGTH');
  }
}
