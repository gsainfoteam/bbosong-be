import { MatterClient, MatterNode } from '@matter-server/ws-client';
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  MATTER_CLIENT_OPTIONS,
  MatterClientModuleOptions,
} from './matter-client.options';

/** ElectricalPowerMeasurement cluster / ActivePower attribute. Path: `{endpoint}/144/8` */
const ELECTRICAL_POWER_CLUSTER_ID = '144';
const ACTIVE_POWER_ATTRIBUTE_ID = '8';

type PowerListener = (macAddress: string, power: number) => void;

@Injectable()
export class MatterConnectionService implements OnModuleInit, OnModuleDestroy {
  private readonly clients = new Map<string, MatterClient>();
  private readonly lastPowerByMac = new Map<string, number>();
  private readonly powerListeners = new Set<PowerListener>();
  private shouldReconnect = true;

  constructor(
    @Inject(MATTER_CLIENT_OPTIONS)
    private readonly options: MatterClientModuleOptions,
  ) {}

  async onModuleInit() {
    await Promise.all(
      this.options.sites.map(async (site) => {
        const client = new MatterClient(site.wsUrl);
        try {
          await client.startListening();
        } catch (error) {
          client.disconnect();
          throw error;
        }
        client.addEventListener('connection_lost', () => {
          console.log(`Connection lost for site ${site.id}`);
          setTimeout(() => {
            if (!this.shouldReconnect) return;
            void (async () => {
              try {
                await client.startListening();
                if (!this.shouldReconnect) {
                  client.disconnect();
                }
              } catch (error) {
                console.error(`Error reconnecting to site ${site.id}:`, error);
              }
            })();
          }, 1000);
        });
        client.addEventListener('nodes_changed', () => {
          this.emitPowerChanges();
        });
        this.clients.set(site.id, client);
      }),
    );
    this.emitPowerChanges();
  }

  onModuleDestroy() {
    this.shouldReconnect = false;
    this.powerListeners.clear();
    this.lastPowerByMac.clear();
    for (const client of this.clients.values()) {
      client.disconnect();
    }
    this.clients.clear();
  }

  private getClient(siteId: string): MatterClient {
    const client = this.clients.get(siteId);
    if (!client) {
      throw new Error(`Client for site ${siteId} not found`);
    }
    return client;
  }

  async commission(siteId: string, payload: string): Promise<string> {
    const client = this.getClient(siteId);
    const node = await client.commissionWithCode(payload, true);
    return node.serialNumber;
  }

  get(macAddress: string): MatterNode {
    for (const client of this.clients.values()) {
      for (const node of Object.values(client.nodes)) {
        if (node.serialNumber === macAddress) {
          return node;
        }
      }
    }
    throw new Error(`Node with mac address ${macAddress} not found`);
  }

  addPowerListener(callback: PowerListener): () => void {
    this.powerListeners.add(callback);
    return () => {
      this.powerListeners.delete(callback);
    };
  }

  private emitPowerChanges(): void {
    const updates: Array<{ macAddress: string; power: number }> = [];

    for (const client of this.clients.values()) {
      for (const node of Object.values(client.nodes)) {
        const macAddress = node.serialNumber;
        const power = this.getActivePower(node);
        if (!macAddress || power === undefined) continue;
        if (this.lastPowerByMac.get(macAddress) === power) continue;

        this.lastPowerByMac.set(macAddress, power);
        updates.push({ macAddress, power });
      }
    }

    if (updates.length === 0) return;

    const listeners = [...this.powerListeners];
    for (const { macAddress, power } of updates) {
      for (const listener of listeners) {
        try {
          listener(macAddress, power);
        } catch (error) {
          console.error(`Power listener failed for mac ${macAddress}:`, error);
        }
      }
    }
  }

  private getActivePower(node: MatterNode): number | undefined {
    for (const [path, value] of Object.entries(node.attributes)) {
      const [, cluster, attribute] = path.split('/');
      if (
        cluster !== ELECTRICAL_POWER_CLUSTER_ID ||
        attribute !== ACTIVE_POWER_ATTRIBUTE_ID
      ) {
        continue;
      }

      if (typeof value === 'number') return value;
      if (typeof value === 'bigint') return Number(value);
    }
    return undefined;
  }
}
