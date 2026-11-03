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
/** Re-sync mapped dryers without re-POSTing unchanged subscriptions. */
const EVENT_REFRESH_MS = 900_000;
/** ThinQ event subscriptions expire after 4464 hours; renew well before that. */
const EVENT_RENEW_MS = 30 * 86_400_000;
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
  private lastEventRenewAt = 0;
  private readonly stateByDeviceId = new Map<string, ThinqDryerState>();
  private subscribedDeviceIds = new Set<string>();
  private readonly pushByDeviceId = new Map<string, Promise<void>>();

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

  /** Keep MQTT merge cache aligned with authoritative REST snapshots. */
  rememberDeviceState(deviceId: string, state: ThinqDryerState): void {
    this.stateByDeviceId.set(deviceId, {
      runState: state.runState ? { ...state.runState } : undefined,
      timer: state.timer ? { ...state.timer } : undefined,
    });
  }

  /** Test seam: apply a decoded MQTT payload. */
  async handlePushPayload(payload: unknown): Promise<void> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return;
    }
    const message = payload as ThinqPushMessage;
    if (typeof message.deviceId !== 'string' || !message.deviceId) return;
    if (
      !message.report ||
      typeof message.report !== 'object' ||
      Array.isArray(message.report)
    ) {
      return;
    }
    const deviceId = message.deviceId;
    const report = message.report;
    const previous = this.pushByDeviceId.get(deviceId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.applyPush(deviceId, report));
    this.pushByDeviceId.set(deviceId, next);
    try {
      await next;
    } finally {
      if (this.pushByDeviceId.get(deviceId) === next) {
        this.pushByDeviceId.delete(deviceId);
      }
    }
  }

  private async applyPush(
    deviceId: string,
    report: ThinqDryerState,
  ): Promise<void> {
    const machines = await this.machineRepository.getMachines();
    const machine = machines.find(
      (entry) =>
        entry.type === MachineType.DRYER && entry.thinqDeviceId === deviceId,
    );
    if (!machine) return;
    const merged = mergeThinqDryerReport(
      this.stateByDeviceId.get(deviceId),
      report,
    );
    this.stateByDeviceId.set(deviceId, merged);
    await this.machineService.updateThinqDryerState(
      machine.uuid,
      deviceId,
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
    const host = await this.withConnectStep('GET /route', () =>
      this.thinqService.getMqttHost(),
    );
    await this.withConnectStep('POST /client', () =>
      this.thinqService.registerMqttClient(),
    );
    const { privateKeyPem, csrBody } = this.createMqttIdentity();
    const issued = await this.withConnectStep('POST /client/certificate', () =>
      this.thinqService.issueMqttCertificate(csrBody),
    );
    const topic = issued.subscriptions[0];
    if (!topic) {
      throw new Error('ThinQ MQTT subscription topic is missing.');
    }
    const ca = await this.withConnectStep('download Amazon Root CA', () =>
      this.downloadAmazonRootCa(),
    );
    if (this.stopped) return;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (finish: () => void) => {
        if (settled) return;
        settled = true;
        finish();
      };
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
        client.subscribe(topic, { qos: 1 }, (error) => {
          if (error) {
            this.client = undefined;
            client.end(true);
            settle(() => reject(error));
            return;
          }
          this.reconnectAttempt = 0;
          settle(() => resolve());
        });
      };
      const onError = (error: Error) => {
        cleanup();
        client.end(true);
        settle(() => reject(error));
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
        settle(() => reject(new Error('ThinQ MQTT closed before connect.')));
        if (this.client !== client) return;
        this.client = undefined;
        this.scheduleReconnect();
      });
    });

    // New MQTT session: re-register device event subscriptions.
    this.lastEventRenewAt = 0;
    await this.withConnectStep('refresh event subscriptions', () =>
      this.refreshEventSubscriptions(),
    );
    await this.withConnectStep('snapshot mapped dryers', () =>
      this.snapshotMappedDryers(),
    );
    this.logger.log('ThinQ MQTT connected.');
  }

  private async withConnectStep<T>(
    step: string,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error: unknown) {
      throw new Error(`ThinQ MQTT ${step} failed: ${formatError(error)}`, {
        cause: error,
      });
    }
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
    const renewAll =
      this.lastEventRenewAt === 0 ||
      Date.now() - this.lastEventRenewAt >= EVENT_RENEW_MS;
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
    for (const deviceId of [...this.subscribedDeviceIds]) {
      if (wanted.has(deviceId)) continue;
      try {
        await this.thinqService.unsubscribeDeviceEvent(deviceId);
        this.subscribedDeviceIds.delete(deviceId);
        this.stateByDeviceId.delete(deviceId);
      } catch (error: unknown) {
        this.logger.error(
          `Failed to unsubscribe ThinQ device ${deviceId}: ${formatError(error)}`,
        );
      }
    }
    for (const deviceId of wanted) {
      if (!renewAll && this.subscribedDeviceIds.has(deviceId)) continue;
      try {
        await this.thinqService.subscribeDeviceEvent(deviceId);
        this.subscribedDeviceIds.add(deviceId);
      } catch (error: unknown) {
        this.logger.error(
          `Failed to subscribe ThinQ device ${deviceId}: ${formatError(error)}`,
        );
      }
    }
    if (renewAll) this.lastEventRenewAt = Date.now();
  }

  private async snapshotMappedDryers(): Promise<void> {
    const machines = await this.machineRepository.getMachines();
    for (const machine of machines) {
      if (this.stopped) return;
      if (machine.type !== MachineType.DRYER || !machine.thinqDeviceId) {
        continue;
      }
      try {
        const state = await this.thinqService.getDryerState(
          machine.thinqDeviceId,
        );
        if (this.stopped) return;
        this.rememberDeviceState(machine.thinqDeviceId, state);
        await this.machineService.updateThinqDryerState(
          machine.uuid,
          machine.thinqDeviceId,
          state,
        );
      } catch (error: unknown) {
        this.logger.error(
          `Failed to snapshot ThinQ machine ${machine.uuid}: ${formatError(error)}`,
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
