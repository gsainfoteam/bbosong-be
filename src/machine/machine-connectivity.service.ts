import { MachineRepository } from '@lib/database/repositories/machine.repository';
import { MatterConnectionService } from '@lib/matter-client/matter-connection.service';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Machine } from 'generated/prisma/client';
import { formatError } from '../common/utils/format-error.util';
import { NotificationService } from '../notification/notification.service';

const CHECK_INTERVAL_MS = 30_000;
const OFFLINE_GRACE_MS = 60_000;

export type MachineConnectivity = {
  isOnline: boolean | null;
  lastSeenAt: Date | null;
};

type ConnectionState = MachineConnectivity & {
  unavailableSince: number | null;
};

@Injectable()
export class MachineConnectivityService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MachineConnectivityService.name);
  // Last confirmed reachable by Matter, not the last power change. Resets on restart.
  private readonly states = new Map<string, ConnectionState>();
  private timer?: NodeJS.Timeout;
  private checking?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly machineRepository: MachineRepository,
    private readonly matterConnectionService: MatterConnectionService,
    private readonly notificationService: NotificationService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.check();
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.checking;
    this.states.clear();
  }

  get(machine: Machine): MachineConnectivity {
    if (machine.deletedAt || !machine.isCommissioned) {
      return { isOnline: null, lastSeenAt: null };
    }
    const state = this.states.get(machine.uuid);
    return {
      isOnline: state?.isOnline ?? null,
      lastSeenAt: state?.lastSeenAt ?? null,
    };
  }

  private check(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.checking) return this.checking;
    this.checking = this.refresh()
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to check machine connectivity: ${formatError(error)}`,
        );
      })
      .finally(() => {
        this.checking = undefined;
      });
    return this.checking;
  }

  private async refresh(): Promise<void> {
    const availableBySite =
      await this.matterConnectionService.getAvailableMacAddressesBySite();
    // Re-read active machines after network I/O, including new commissions and deletions.
    const machines = await this.machineRepository.getMachines();
    if (this.stopped) return;
    const monitored = new Set<string>();
    for (const machine of machines) {
      if (machine.deletedAt || !machine.isCommissioned) continue;
      monitored.add(machine.uuid);
      // Missing sites indicate a failed query, not confirmed device unavailability.
      if (!availableBySite.has(machine.location)) continue;
      const state: ConnectionState = {
        ...(this.states.get(machine.uuid) ?? {
          isOnline: null,
          lastSeenAt: null,
          unavailableSince: null,
        }),
      };
      const previous = state.isOnline;
      const now = Date.now();
      const available =
        machine.macAddress &&
        availableBySite.get(machine.location)?.has(machine.macAddress);
      if (available) {
        state.isOnline = true;
        state.lastSeenAt = new Date(now);
        state.unavailableSince = null;
      } else {
        state.unavailableSince ??= now;
        if (now - state.unavailableSince >= OFFLINE_GRACE_MS)
          state.isOnline = false;
      }
      if (state.isOnline === previous) {
        this.states.set(machine.uuid, state);
        continue;
      }

      // A deletion during this check must not generate a connectivity alert.
      if (!(await this.machineRepository.getMachine(machine.uuid))) {
        this.states.delete(machine.uuid);
        continue;
      }
      if (this.stopped) return;
      this.states.set(machine.uuid, state);
      const message = `Machine ${machine.uuid} (${machine.location}/${machine.gender}/${machine.type}/${machine.index}) ${state.isOnline ? 'online' : 'offline'}; lastSeenAt=${state.lastSeenAt?.toISOString() ?? 'never'}`;
      if (state.isOnline) {
        this.logger.log(message);
      } else {
        this.logger.warn(message);
        try {
          await this.notificationService.notifyMachineOffline(machine);
        } catch (error: unknown) {
          this.logger.error(
            `Failed to notify machine ${machine.uuid} offline: ${formatError(error)}`,
          );
        }
      }
    }
    for (const uuid of this.states.keys()) {
      if (!monitored.has(uuid)) this.states.delete(uuid);
    }
  }
}
