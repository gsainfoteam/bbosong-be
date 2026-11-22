import type { MachineRepository } from '@lib/database/repositories/machine.repository';
import { ConfigService } from '@nestjs/config';
import { BbosongConfigService } from '../config/bbosong-config.service';
import { MachinePowerCleanupService } from './machine-power-cleanup.service';

jest.mock('@nestjs/schedule', () => ({ Cron: () => () => undefined }));
jest.mock('@lib/database/repositories/machine.repository', () => ({}));

describe('MachinePowerCleanupService', () => {
  const build = (days?: string) => {
    const deleteMachinePowerBefore = jest.fn().mockResolvedValue(3);
    const service = new MachinePowerCleanupService(
      { deleteMachinePowerBefore } as unknown as MachineRepository,
      new BbosongConfigService(
        new ConfigService({ MACHINE_POWER_RETENTION_DAYS: days }),
      ),
    );
    return { service, deleteMachinePowerBefore };
  };

  it('deletes rows older than the default 30 days', async () => {
    const { service, deleteMachinePowerBefore } = build();
    const now = Date.now();
    await service.cleanup();
    const [before] = deleteMachinePowerBefore.mock.calls[0] as [Date];
    expect(Math.abs(now - 30 * 86_400_000 - before.getTime())).toBeLessThan(
      1000,
    );
  });

  it('falls back to the default for invalid retention values', async () => {
    const { service, deleteMachinePowerBefore } = build('0');
    const now = Date.now();
    await service.cleanup();
    const [before] = deleteMachinePowerBefore.mock.calls[0] as [Date];
    expect(Math.abs(now - 30 * 86_400_000 - before.getTime())).toBeLessThan(
      1000,
    );
  });

  it('does not throw when deletion fails', async () => {
    const { service, deleteMachinePowerBefore } = build('7');
    deleteMachinePowerBefore.mockRejectedValue(new Error('db'));
    await expect(service.cleanup()).resolves.toBeUndefined();
  });
});
