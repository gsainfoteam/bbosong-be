import { MACHINE_REREGISTRATION_MIN_DURATION_MS } from '@lib/database/constants/machine-registration';
import { UsingMachineRepository } from '@lib/database/repositories/using-machine.repository';
import type { DatabaseService } from '@lib/database/database.service';

jest.mock('@gsainfoteam/nest-observability', () => ({
  Trace: () => (target: unknown) => target,
}));
jest.mock('@lib/logger', () => ({
  Loggable: () => (target: unknown) => target,
}));
jest.mock('@lib/database/database.service', () => ({}));

describe('UsingMachineRepository.countDailySessionsByRegistration', () => {
  const queryRaw = jest.fn();
  let repository: UsingMachineRepository;

  beforeEach(() => {
    queryRaw.mockReset();
    repository = new UsingMachineRepository({
      $queryRaw: queryRaw,
    } as unknown as DatabaseService);
  });

  it('calls $queryRaw with KST day-bucket SQL and maps bigint counts to numbers', async () => {
    queryRaw.mockResolvedValue([
      { date: '2026-11-10', registeredCount: 1n, unregisteredCount: 1n },
      { date: '2026-11-11', registeredCount: 0n, unregisteredCount: 0n },
      { date: '2026-11-12', registeredCount: 1, unregisteredCount: 0 },
    ]);

    const rows = await repository.countDailySessionsByRegistration(
      '2026-11-10',
      '2026-11-12',
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const sql = strings.join(' ');
    expect(sql).toContain('generate_series');
    expect(sql).toContain('Asia/Seoul');
    expect(sql).toContain("::date - interval '9 hours'");
    expect(sql).toContain("::date + interval '1 day' - interval '9 hours'");
    expect(sql).toContain('ended_at IS NOT NULL');
    expect(sql).toContain('EXTRACT(EPOCH FROM (ended_at - started_at))');
    expect(sql).toContain('user_uuid IS NOT NULL');
    expect(sql).toContain('user_uuid IS NULL');
    expect(values).toEqual([
      '2026-11-10',
      '2026-11-12',
      '2026-11-10',
      '2026-11-12',
      MACHINE_REREGISTRATION_MIN_DURATION_MS,
    ]);
    expect(rows).toEqual([
      { date: '2026-11-10', registeredCount: 1, unregisteredCount: 1 },
      { date: '2026-11-11', registeredCount: 0, unregisteredCount: 0 },
      { date: '2026-11-12', registeredCount: 1, unregisteredCount: 0 },
    ]);
    expect(typeof rows[0].registeredCount).toBe('number');
    expect(typeof rows[0].unregisteredCount).toBe('number');
  });
});
