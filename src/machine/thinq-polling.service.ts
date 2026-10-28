import { MachineRepository } from '@lib/database/repositories/machine.repository';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { MachineType } from 'generated/prisma/client';
import { formatError } from '../common/utils/format-error.util';
import { ThinqService } from '../thinq/thinq.service';
import { MachineService } from './machine.service';

const DEVICE_LIST_REFRESH_MS = 900_000;

@Injectable()
export class ThinqPollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ThinqPollingService.name);
  private timer?: NodeJS.Timeout;
  private polling?: Promise<void>;
  private stopped = false;
  private deviceIds?: Set<string>;
  private deviceListUpdatedAt = 0;

  constructor(
    private readonly thinqService: ThinqService,
    private readonly machineRepository: MachineRepository,
    private readonly machineService: MachineService,
  ) {}

  onModuleInit(): void {
    if (!this.thinqService.enabled) {
      this.logger.log('ThinQ integration is disabled.');
      return;
    }
    void this.poll();
    this.timer = setInterval(
      () => void this.poll(),
      this.thinqService.pollIntervalMs,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    await this.polling;
  }

  private poll(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.polling) return this.polling;
    this.polling = this.refresh()
      .catch((error: unknown) => {
        this.logger.error(`Failed to poll ThinQ: ${formatError(error)}`);
      })
      .finally(() => {
        this.polling = undefined;
      });
    return this.polling;
  }

  private async refresh(): Promise<void> {
    // The official API requires the device list before the first state request.
    if (
      !this.deviceIds ||
      Date.now() - this.deviceListUpdatedAt >= DEVICE_LIST_REFRESH_MS
    ) {
      const devices = await this.thinqService.getDevices();
      this.deviceIds = new Set(devices.map((device) => device.deviceId));
      this.deviceListUpdatedAt = Date.now();
    }
    const machines = await this.machineRepository.getMachines();
    for (const machine of machines) {
      if (this.stopped) return;
      if (
        machine.type !== MachineType.DRYER ||
        !machine.thinqDeviceId ||
        !this.deviceIds.has(machine.thinqDeviceId)
      ) {
        continue;
      }
      try {
        const state = await this.thinqService.getDryerState(
          machine.thinqDeviceId,
        );
        if (this.stopped) return;
        await this.machineService.updateThinqDryerState(
          machine.uuid,
          machine.thinqDeviceId,
          state,
        );
      } catch (error: unknown) {
        this.logger.error(
          `Failed to poll ThinQ machine ${machine.uuid}: ${formatError(error)}`,
        );
      }
    }
  }
}
