import { HttpService } from '@nestjs/axios';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAxiosError } from 'axios';
import { randomUUID } from 'node:crypto';
import { firstValueFrom } from 'rxjs';

export type ThinqDevice = {
  deviceId: string;
  deviceInfo: {
    deviceType: string;
    modelName: string;
    alias: string;
  };
};

export type ThinqDryerState = {
  runState?: { currentState?: string };
  timer?: { remainHour?: number; remainMinute?: number };
};

export type ThinqMqttCertificate = {
  certificatePem: string;
  subscriptions: string[];
};

// Regional servers and read-only fields from the official ThinQ Connect OpenAPI:
// https://smartsolution.developer.lge.com/ko/apiManage/thinq_connect
const THINQ_API_SERVERS = [
  'https://api-kic.lgthinq.com',
  'https://api-aic.lgthinq.com',
  'https://api-eic.lgthinq.com',
];

const MQTT_CLIENT_BODY = {
  type: 'MQTT',
  'service-code': 'SVC202',
  'device-type': '607',
  allowExist: true,
} as const;

@Injectable()
export class ThinqService {
  private readonly token?: string;
  private readonly country?: string;
  private readonly clientId?: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private retryAt = 0;
  private rateLimitBackoffMs = 60_000;
  /** Sparse REST reconcile interval for DRY machines (MQTT is primary). */
  readonly pollIntervalMs: number;

  constructor(
    private readonly httpService: HttpService,
    configService: ConfigService,
  ) {
    this.token = configService.get<string>('THINQ_PAT')?.trim();
    this.country = configService.get<string>('THINQ_COUNTRY_CODE')?.trim();
    this.clientId = configService.get<string>('THINQ_CLIENT_ID')?.trim();
    this.apiKey = configService.get<string>('THINQ_API_KEY')?.trim();
    this.baseUrl = configService.get<string>(
      'THINQ_BASE_URL',
      THINQ_API_SERVERS[0],
    );
    const interval = Number(
      configService.get('THINQ_POLL_INTERVAL_SECONDS', 600),
    );
    // Reconcile-only cadence; MQTT carries live updates. OpenAPI has no numeric quota.
    this.pollIntervalMs =
      Number.isFinite(interval) && interval >= 300 && interval <= 86_400
        ? interval * 1000
        : 600_000;
  }

  get enabled(): boolean {
    return Boolean(
      this.token &&
      this.country &&
      /^[A-Z]{2}$/.test(this.country) &&
      this.clientId &&
      this.apiKey &&
      THINQ_API_SERVERS.includes(this.baseUrl),
    );
  }

  get thinqClientId(): string | undefined {
    return this.clientId;
  }

  async getDevices(): Promise<ThinqDevice[]> {
    const response = await this.request<ThinqDevice[]>('GET', '/devices');
    if (
      !Array.isArray(response) ||
      response.some((device) => typeof device?.deviceId !== 'string')
    ) {
      throw new ServiceUnavailableException('Invalid ThinQ device list.');
    }
    return response;
  }

  async getDryerState(deviceId: string): Promise<ThinqDryerState> {
    const response = await this.request<ThinqDryerState>(
      'GET',
      `/devices/${encodeURIComponent(deviceId)}/state`,
    );
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      throw new ServiceUnavailableException('Invalid ThinQ dryer state.');
    }
    return response;
  }

  async getMqttHost(): Promise<string> {
    const route = await this.request<{ mqttServer?: string }>('GET', '/route');
    const server = route?.mqttServer;
    if (typeof server !== 'string' || !server) {
      throw new ServiceUnavailableException('Invalid ThinQ MQTT route.');
    }
    return server.replace(/^mqtts:\/\//, '').split(':', 1)[0];
  }

  async registerMqttClient(): Promise<void> {
    await this.request('POST', '/client', MQTT_CLIENT_BODY);
  }

  async unregisterMqttClient(): Promise<void> {
    await this.request('DELETE', '/client', MQTT_CLIENT_BODY);
  }

  async issueMqttCertificate(csr: string): Promise<ThinqMqttCertificate> {
    const response = await this.request<{
      result?: { certificatePem?: string; subscriptions?: string[] };
    }>('POST', '/client/certificate', {
      'service-code': 'SVC202',
      csr,
    });
    const certificatePem = response?.result?.certificatePem;
    const subscriptions = response?.result?.subscriptions;
    if (
      typeof certificatePem !== 'string' ||
      !certificatePem ||
      !Array.isArray(subscriptions) ||
      typeof subscriptions[0] !== 'string'
    ) {
      throw new ServiceUnavailableException('Invalid ThinQ MQTT certificate.');
    }
    return { certificatePem, subscriptions };
  }

  async subscribeDeviceEvent(deviceId: string): Promise<void> {
    await this.request(
      'POST',
      `/event/${encodeURIComponent(deviceId)}/subscribe`,
      { expire: { unit: 'HOUR', timer: 4464 } },
    );
  }

  async unsubscribeDeviceEvent(deviceId: string): Promise<void> {
    await this.request(
      'DELETE',
      `/event/${encodeURIComponent(deviceId)}/unsubscribe`,
    );
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('ThinQ integration is disabled.');
    }
    if (Date.now() < this.retryAt) {
      throw new ServiceUnavailableException('ThinQ requests are backing off.');
    }
    try {
      const { data } = await firstValueFrom(
        this.httpService.request<{ response: T }>({
          method,
          url: `${this.baseUrl}${path}`,
          data: body,
          headers: {
            Authorization: `Bearer ${this.token}`,
            'x-country': this.country,
            'x-client-id': this.clientId,
            'x-api-key': this.apiKey,
            'x-message-id': Buffer.from(
              randomUUID().replace(/-/g, ''),
              'hex',
            ).toString('base64url'),
          },
        }),
      );
      this.rateLimitBackoffMs = 60_000;
      return data.response;
    } catch (error: unknown) {
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (status === 429) {
        this.retryAt = Date.now() + this.rateLimitBackoffMs;
        this.rateLimitBackoffMs = Math.min(
          this.rateLimitBackoffMs * 2,
          900_000,
        );
      } else if (status === 401 || status === 403) {
        this.retryAt = Date.now() + 900_000;
      }
      // Axios errors contain request headers, including the PAT. Never propagate them.
      throw new ServiceUnavailableException(
        status
          ? `ThinQ request failed (HTTP ${status}).`
          : 'ThinQ request failed.',
      );
    }
  }
}
