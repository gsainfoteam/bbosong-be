import { MatterClient, MatterNode } from '@matter-server/ws-client';
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { groupBy, mergeMap, Observable, Subject, Subscription } from 'rxjs';
import {
  MATTER_CLIENT_OPTIONS,
  MatterClientModuleOptions,
} from './matter-client.options';

/** ElectricalPowerMeasurement cluster / ActivePower attribute. Path: `{endpoint}/144/8` */
const ELECTRICAL_POWER_CLUSTER_ID = '144';
const ACTIVE_POWER_ATTRIBUTE_ID = '8';
const POWER_UPDATE_QUEUE_LIMIT = 16;

type PowerListener = (
  macAddress: string,
  power: number,
) => void | Promise<void>;

type PowerUpdate = {
  macAddress: string;
  power: number;
};

type PowerListenerStream = {
  updates$: Subject<PowerUpdate>;
  subscription: Subscription;
  drained: Promise<void>;
};

function boundedConcatMap<T>(
  project: (value: T) => Promise<void>,
  maxQueued: number,
  onOverflow: (value: T) => void,
): (source: Observable<T>) => Observable<void> {
  return (source) =>
    new Observable<void>((subscriber) => {
      const queue: T[] = [];
      let inFlight = false;
      let sourceCompleted = false;
      let stopped = false;

      const finishIfIdle = () => {
        if (stopped) return;
        if (sourceCompleted && !inFlight && queue.length === 0) {
          stopped = true;
          subscriber.complete();
        }
      };

      const pump = async () => {
        if (inFlight) return;
        inFlight = true;
        while (queue.length > 0 && !stopped) {
          const value = queue.shift()!;
          try {
            await project(value);
          } catch (error) {
            stopped = true;
            subscriber.error(error);
            return;
          }
        }
        inFlight = false;
        finishIfIdle();
      };

      const subscription = source.subscribe({
        next: (value) => {
          if (stopped) return;
          if (queue.length >= maxQueued) {
            onOverflow(value);
            return;
          }
          queue.push(value);
          void pump();
        },
        error: (error) => {
          if (stopped) return;
          stopped = true;
          subscriber.error(error);
        },
        complete: () => {
          sourceCompleted = true;
          finishIfIdle();
        },
      });

      return () => {
        stopped = true;
        queue.length = 0;
        subscription.unsubscribe();
      };
    });
}

@Injectable()
export class MatterConnectionService implements OnModuleInit, OnModuleDestroy {
  private readonly clients = new Map<string, MatterClient>();
  private readonly lastPowerByMac = new Map<string, number>();
  private readonly listenerStreams = new Map<
    PowerListener,
    PowerListenerStream
  >();
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

  async onModuleDestroy() {
    this.shouldReconnect = false;
    await Promise.all(
      [...this.listenerStreams.keys()].map((callback) =>
        this.removePowerListener(callback),
      ),
    );
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

  addPowerListener(callback: PowerListener): () => Promise<void> {
    const stream = this.createListenerStream(callback);
    this.listenerStreams.set(callback, stream);
    this.enqueuePowerUpdates(this.collectPowerUpdates(false), stream);
    return () => this.removePowerListener(callback);
  }

  private createListenerStream(callback: PowerListener): PowerListenerStream {
    const updates$ = new Subject<PowerUpdate>();
    let resolveDrained: () => void;
    const drained = new Promise<void>((resolve) => {
      resolveDrained = resolve;
    });
    const subscription = updates$
      .pipe(
        groupBy((update) => update.macAddress),
        mergeMap((group$) =>
          group$.pipe(
            boundedConcatMap(
              async ({ macAddress, power }) => {
                try {
                  await Promise.resolve(callback(macAddress, power));
                } catch (error) {
                  console.error(
                    `Power listener failed for mac ${macAddress}:`,
                    error,
                  );
                }
              },
              POWER_UPDATE_QUEUE_LIMIT,
              ({ macAddress, power }) => {
                console.error(
                  `Power update queue overflow for mac ${macAddress}, dropping power ${power}`,
                );
              },
            ),
          ),
        ),
      )
      .subscribe({
        error: (error) => {
          console.error('Power listener pipeline failed:', error);
          resolveDrained();
        },
        complete: () => resolveDrained(),
      });

    return { updates$, subscription, drained };
  }

  private async removePowerListener(callback: PowerListener): Promise<void> {
    const stream = this.listenerStreams.get(callback);
    if (!stream) return;

    this.listenerStreams.delete(callback);
    stream.updates$.complete();
    await stream.drained;
  }

  private emitPowerChanges(): void {
    this.enqueuePowerUpdates(this.collectPowerUpdates(true));
  }

  private collectPowerUpdates(onlyChanged: boolean): PowerUpdate[] {
    const updates: PowerUpdate[] = [];

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

  private enqueuePowerUpdates(
    updates: PowerUpdate[],
    stream?: PowerListenerStream,
  ): void {
    const targets = stream ? [stream] : [...this.listenerStreams.values()];
    for (const update of updates) {
      this.lastPowerByMac.set(update.macAddress, update.power);
      for (const target of targets) {
        target.updates$.next(update);
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
