import { MACHINE_REREGISTRATION_MIN_DURATION_MS } from '@lib/database/constants/machine-registration';
import { UsingMachineRepository } from '@lib/database/repositories/using-machine.repository';
import type { DatabaseService } from '@lib/database/database.service';
import { Gender, Location, MachineType } from 'generated/prisma/client';

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
    expect(sql).toContain('EXTRACT(EPOCH FROM (us.ended_at - us.started_at))');
    expect(sql).toContain('JOIN machine m ON m.uuid = us.machine_uuid');
    expect(sql).toContain('user_uuid IS NOT NULL');
    expect(sql).toContain('user_uuid IS NULL');
    expect(values).toEqual([
      '2026-11-10',
      '2026-11-12',
      '2026-11-10',
      '2026-11-12',
      MACHINE_REREGISTRATION_MIN_DURATION_MS,
      null,
      null,
      null,
      null,
    ]);
    expect(rows).toEqual([
      { date: '2026-11-10', registeredCount: 1, unregisteredCount: 1 },
      { date: '2026-11-11', registeredCount: 0, unregisteredCount: 0 },
      { date: '2026-11-12', registeredCount: 1, unregisteredCount: 0 },
    ]);
    expect(typeof rows[0].registeredCount).toBe('number');
    expect(typeof rows[0].unregisteredCount).toBe('number');
  });

  it('binds provided machine filters and nulls for omitted ones', async () => {
    queryRaw.mockResolvedValue([]);

    await repository.countDailySessionsByRegistration(
      '2026-11-10',
      '2026-11-10',
      {
        location: Location.B,
        gender: Gender.FEMALE,
        type: MachineType.DRYER,
      },
    );

    const [strings, ...values] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const sql = strings.join(' ');
    expect(sql).toContain('JOIN machine m ON m.uuid = us.machine_uuid');
    expect(sql).toContain('m.location = ');
    expect(sql).toContain('m.gender = ');
    expect(sql).toContain('m.type = ');
    expect(values.slice(-4)).toEqual([
      Location.B,
      Gender.FEMALE,
      MachineType.DRYER,
      null,
    ]);
  });

  it('omits machine filter conditions when no filter is given', async () => {
    queryRaw.mockResolvedValue([]);

    await repository.countDailySessionsByRegistration(
      '2026-11-10',
      '2026-11-10',
    );

    const [, ...values] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(values.slice(-4)).toEqual([null, null, null, null]);
  });
});

describe('UsingMachineRepository.countUsageStats', () => {
  const queryRaw = jest.fn();
  let repository: UsingMachineRepository;

  beforeEach(() => {
    queryRaw.mockReset();
    repository = new UsingMachineRepository({
      $queryRaw: queryRaw,
    } as unknown as DatabaseService);
  });

  // Prisma.sql fragments are nested in the tagged template values.
  const render = (parts: readonly string[], vals: readonly unknown[]): string =>
    parts.reduce((acc, part, i) => {
      const v = vals[i - 1] as
        { strings: string[]; values: unknown[] } | undefined;
      const inner =
        i === 0 ? '' : v?.strings ? render(v.strings, v.values) : '?';
      return acc + inner + part;
    }, '');
  const flattenSql = (): string => {
    const [strings, ...values] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    return render(strings, values);
  };

  it('groups by requested dimensions in canonical order and coerces numbers', async () => {
    queryRaw.mockResolvedValue([
      { weekday: 1, hour: 14n, location: 'A', sessionCount: 3n },
    ]);

    const rows = await repository.countUsageStats('2026-11-01', '2026-11-10', [
      'location',
      'hour',
      'weekday',
    ]);

    const sql = flattenSql();
    expect(sql).toMatch(
      /ISODOW[\s\S]*AS "weekday", [\s\S]*HOUR[\s\S]*AS "hour", m\.location::text AS "location", COUNT\(\*\) AS "sessionCount"/,
    );
    expect(sql).toContain('GROUP BY 1, 2, 3 ORDER BY 1, 2, 3');
    expect(sql).toContain('ended_at IS NOT NULL');
    expect(rows).toEqual([
      { weekday: 1, hour: 14, location: 'A', sessionCount: 3 },
    ]);
  });

  it('returns only a total, without GROUP BY, when no dimension is requested', async () => {
    queryRaw.mockResolvedValue([{ sessionCount: 5n }]);

    const rows = await repository.countUsageStats('2026-11-01', '2026-11-10');

    expect(flattenSql()).not.toContain('GROUP BY');
    expect(rows).toEqual([{ sessionCount: 5 }]);
  });
});
