import { MachineRepository } from '@lib/database/repositories/machine.repository';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { formatError } from '../common/utils/format-error.util';

const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

@Injectable()
export class MachinePowerCleanupService {
  private readonly logger = new Logger(MachinePowerCleanupService.name);
  private readonly retentionMs: number;
  private running = false;

  constructor(
    private readonly machineRepository: MachineRepository,
    configService: ConfigService,
  ) {
    const days = Number(
      configService.get('MACHINE_POWER_RETENTION_DAYS', DEFAULT_RETENTION_DAYS),
    );
    this.retentionMs =
      (Number.isFinite(days) && days >= 1 ? days : DEFAULT_RETENTION_DAYS) *
      DAY_MS;
  }

  @Cron('0 3 * * *')
  async cleanup(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const count = await this.machineRepository.deleteMachinePowerBefore(
        new Date(Date.now() - this.retentionMs),
      );
      if (count > 0) {
        this.logger.log(`Deleted ${count} machine power logs past retention.`);
      }
    } catch (error: unknown) {
      this.logger.error(
        `Failed to delete old machine power logs: ${formatError(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
