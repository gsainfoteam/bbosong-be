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

@Injectable()
export class MatterConnectionService implements OnModuleInit, OnModuleDestroy {
  private readonly clients = new Map<string, MatterClient>();
  private readonly lastPowerByMac = new Map<string, number>();
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
        this.clients.set(site.id, client);
      }),
    );
  }

  onModuleDestroy() {
    this.shouldReconnect = false;
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

  addPowerListener(
    callback: (macAddress: string, power: number) => void,
  ): () => void {
    this.updateLastPower();

    const unsubscribers: Array<() => void> = [];
    for (const client of this.clients.values()) {
      unsubscribers.push(
        client.addEventListener('nodes_changed', () => {
          this.updateLastPower(callback);
        }),
      );
    }

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }

  private updateLastPower(
    callback?: (macAddress: string, power: number) => void,
  ): void {
    for (const client of this.clients.values()) {
      for (const node of Object.values(client.nodes)) {
        const macAddress = node.serialNumber;
        const power = this.getActivePower(node);
        if (!macAddress || power === undefined) continue;
        if (this.lastPowerByMac.get(macAddress) === power) continue;

        this.lastPowerByMac.set(macAddress, power);
        callback?.(macAddress, power);
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
