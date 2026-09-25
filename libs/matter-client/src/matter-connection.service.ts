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

@Injectable()
export class MatterConnectionService implements OnModuleInit, OnModuleDestroy {
  private readonly clients = new Map<string, MatterClient>();

  constructor(
    @Inject(MATTER_CLIENT_OPTIONS)
    private readonly options: MatterClientModuleOptions,
  ) {}

  onModuleInit() {
    for (const site of this.options.sites) {
      const client = new MatterClient(site.wsUrl);
      void client.startListening();
      client.addEventListener('connection_lost', () => {
        console.log(`Connection lost for site ${site.id}`);
        setTimeout(() => {
          void (async () => {
            try {
              await client.startListening();
            } catch (error) {
              console.error(`Error reconnecting to site ${site.id}:`, error);
            }
          })();
        }, 1000);
      });
      this.clients.set(site.id, client);
    }
  }

  onModuleDestroy() {
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
}
