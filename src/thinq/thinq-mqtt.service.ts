import { MachineRepository } from '@lib/database/repositories/machine.repository';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { MachineType } from 'generated/prisma/client';
import forge from 'node-forge';
import mqtt, { type MqttClient } from 'mqtt';
import { formatError } from '../common/utils/format-error.util';
import { MachineService } from '../machine/machine.service';
import { mergeThinqDryerReport } from './thinq-state-merge';
import { type ThinqDryerState, ThinqService } from './thinq.service';

const AMAZON_ROOT_CA_URL =
  'https://www.amazontrust.com/repository/AmazonRootCA1.pem';
/** Re-sync device event subscriptions when admins map/unmap dryers. */
const EVENT_REFRESH_MS = 900_000;
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 300_000;

type ThinqPushMessage = {
  deviceId?: string;
  report?: ThinqDryerState;
};

@Injectable()
export class ThinqMqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ThinqMqttService.name);
  private client?: MqttClient;
  private stopped = false;
  private connecting?: Promise<void>;
  private reconnectAttempt = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private eventRefreshTimer?: NodeJS.Timeout;
  private readonly stateByDeviceId = new Map<string, ThinqDryerState>();
  private subscribedDeviceIds = new Set<string>();

  constructor(
    private readonly thinqService: ThinqService,
    private readonly machineRepository: MachineRepository,
    private readonly machineService: MachineService,
  ) {}

  onModuleInit(): void {
    if (!this.thinqService.enabled) {
      this.logger.log('ThinQ MQTT is disabled.');
      return;
    }
    void this.ensureConnected();
    this.eventRefreshTimer = setInterval(
      () =>
        void this.refreshEventSubscriptions().catch((error: unknown) => {
          this.logger.error(
            `Failed to refresh ThinQ event subscriptions: ${formatError(error)}`,
          );
        }),
      EVENT_REFRESH_MS,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.eventRefreshTimer);
    await this.connecting;
    const client = this.client;
    this.client = undefined;
    if (!client) return;
    await new Promise<void>((resolve) => {
      client.end(true, {}, () => resolve());
    });
    try {
      await this.thinqService.unregisterMqttClient();
    } catch (error: unknown) {
      this.logger.error(
        `Failed to unregister ThinQ MQTT client: ${formatError(error)}`,
      );
    }
  }

  /** Test seam: apply a decoded MQTT payload. */
  async handlePushPayload(payload: unknown): Promise<void> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return;
    }
    const message = payload as ThinqPushMessage;
    if (typeof message.deviceId !== 'string' || !message.deviceId) return;
    const merged = mergeThinqDryerReport(
      this.stateByDeviceId.get(message.deviceId),
      message.report,
    );
    this.stateByDeviceId.set(message.deviceId, merged);
    const machines = await this.machineRepository.getMachines();
    const machine = machines.find(
      (entry) =>
        entry.type === MachineType.DRYER &&
        entry.thinqDeviceId === message.deviceId,
    );
    if (!machine) return;
    await this.machineService.updateThinqDryerState(
      machine.uuid,
      message.deviceId,
      merged,
    );
  }

  private ensureConnected(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.connecting) return this.connecting;
    if (this.client?.connected) return Promise.resolve();
    this.connecting = this.connect()
      .catch((error: unknown) => {
        this.logger.error(`ThinQ MQTT connect failed: ${formatError(error)}`);
        this.scheduleReconnect();
      })
      .finally(() => {
        this.connecting = undefined;
      });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    const clientId = this.thinqService.thinqClientId;
    if (!clientId) {
      throw new Error('ThinQ client id is missing.');
    }
    const host = await this.thinqService.getMqttHost();
    await this.thinqService.registerMqttClient();
    const { privateKeyPem, csrBody } = this.createMqttIdentity();
    const issued = await this.thinqService.issueMqttCertificate(csrBody);
    const ca = await this.downloadAmazonRootCa();
    if (this.stopped) return;

    await new Promise<void>((resolve, reject) => {
      const client = mqtt.connect(`mqtts://${host}:8883`, {
        clientId,
        key: privateKeyPem,
        cert: issued.certificatePem,
        ca,
        rejectUnauthorized: true,
        clean: false,
        keepalive: 30,
        reconnectPeriod: 0,
      });
      const onConnect = () => {
        cleanup();
        this.client = client;
        this.reconnectAttempt = 0;
        client.subscribe(issued.subscriptions[0], { qos: 1 }, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      };
      const onError = (error: Error) => {
        cleanup();
        client.end(true);
        reject(error);
      };
      const cleanup = () => {
        client.off('connect', onConnect);
        client.off('error', onError);
      };
      client.on('connect', onConnect);
      client.on('error', onError);
      client.on('message', (_topic, buffer) => {
        void this.onMessage(buffer);
      });
      client.on('close', () => {
        if (this.client !== client) return;
        this.client = undefined;
        this.scheduleReconnect();
      });
    });

    await this.refreshEventSubscriptions();
    this.logger.log('ThinQ MQTT connected.');
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.ensureConnected();
    }, delay);
  }

  private async onMessage(buffer: Buffer): Promise<void> {
    try {
      const payload: unknown = JSON.parse(buffer.toString('utf8'));
      await this.handlePushPayload(payload);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to handle ThinQ MQTT message: ${formatError(error)}`,
      );
    }
  }

  private async refreshEventSubscriptions(): Promise<void> {
    if (!this.thinqService.enabled || this.stopped) return;
    const machines = await this.machineRepository.getMachines();
    const wanted = new Set(
      machines
        .filter(
          (machine) =>
            machine.type === MachineType.DRYER &&
            typeof machine.thinqDeviceId === 'string' &&
            machine.thinqDeviceId,
        )
        .map((machine) => machine.thinqDeviceId as string),
    );
    for (const deviceId of this.subscribedDeviceIds) {
      if (wanted.has(deviceId)) continue;
      try {
        await this.thinqService.unsubscribeDeviceEvent(deviceId);
      } catch (error: unknown) {
        this.logger.error(
          `Failed to unsubscribe ThinQ device ${deviceId}: ${formatError(error)}`,
        );
      }
      this.subscribedDeviceIds.delete(deviceId);
      this.stateByDeviceId.delete(deviceId);
    }
    for (const deviceId of wanted) {
      try {
        await this.thinqService.subscribeDeviceEvent(deviceId);
        this.subscribedDeviceIds.add(deviceId);
      } catch (error: unknown) {
        this.logger.error(
          `Failed to subscribe ThinQ device ${deviceId}: ${formatError(error)}`,
        );
      }
    }
  }

  private createMqttIdentity(): { privateKeyPem: string; csrBody: string } {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    csr.setSubject([{ name: 'commonName', value: 'lg_thinq' }]);
    csr.sign(keys.privateKey, forge.md.sha512.create());
    const csrPem = forge.pki.certificationRequestToPem(csr);
    const csrBody = csrPem
      .replace('-----BEGIN CERTIFICATE REQUEST-----', '')
      .replace('-----END CERTIFICATE REQUEST-----', '')
      .replace(/\s+/g, '');
    return {
      privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
      csrBody,
    };
  }

  private async downloadAmazonRootCa(): Promise<string> {
    const response = await fetch(AMAZON_ROOT_CA_URL);
    if (!response.ok) {
      throw new Error(`Amazon Root CA download failed (${response.status}).`);
    }
    const pem = await response.text();
    if (!pem.includes('BEGIN CERTIFICATE')) {
      throw new Error('Amazon Root CA download returned invalid PEM.');
    }
    return pem;
  }
}
