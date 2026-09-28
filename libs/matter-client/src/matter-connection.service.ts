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

type PowerListener = (
  macAddress: string,
  power: number,
) => void | Promise<void>;

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
                  return;
                }
                this.emitPowerChanges();
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
    void this.dispatchPowerUpdates(this.collectPowerUpdates(false), [
      callback,
    ]);
    return () => {
      this.powerListeners.delete(callback);
    };
  }

  private emitPowerChanges(): void {
    void this.dispatchPowerUpdates(this.collectPowerUpdates(true), [
      ...this.powerListeners,
    ]);
  }

  private collectPowerUpdates(onlyChanged: boolean): Array<{
    macAddress: string;
    power: number;
  }> {
    const updates: Array<{ macAddress: string; power: number }> = [];

    for (const client of this.clients.values()) {
      for (const node of Object.values(client.nodes)) {
        const macAddress = node.serialNumber;
        const power = this.getActivePower(node);
        if (!macAddress || power === undefined) continue;
        if (onlyChanged && this.lastPowerByMac.get(macAddress) === power) {
          continue;
        }

        updates.push({ macAddress, power });
      }
    }

    return updates;
  }

  private async dispatchPowerUpdates(
    updates: Array<{ macAddress: string; power: number }>,
    listeners: PowerListener[],
  ): Promise<void> {
    if (updates.length === 0 || listeners.length === 0) return;

    for (const { macAddress, power } of updates) {
      this.lastPowerByMac.set(macAddress, power);
      for (const listener of listeners) {
        try {
          await Promise.resolve(listener(macAddress, power));
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
