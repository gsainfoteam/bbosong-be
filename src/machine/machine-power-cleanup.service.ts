import { MachineRepository } from '@lib/database/repositories/machine.repository';
import { Injectable, Logger } from '@nestjs/common';
import { BbosongConfigService } from '../config/bbosong-config.service';
import { Cron } from '@nestjs/schedule';
import { formatError } from '../common/utils/format-error.util';

const DAY_MS = 86_400_000;

@Injectable()
export class MachinePowerCleanupService {
  private readonly logger = new Logger(MachinePowerCleanupService.name);
  private readonly retentionMs: number;
  private running = false;

  constructor(
    private readonly machineRepository: MachineRepository,
    configService: BbosongConfigService,
  ) {
    this.retentionMs = configService.machinePowerRetentionDays * DAY_MS;
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
