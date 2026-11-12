# Daily Session Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin endpoint that returns per-KST-day registered vs unregistered `UsingMachine` session counts for a date range, filling empty days with zeros, without schema changes.

**Architecture:** Validate `from`/`to` in a request DTO; aggregate in `UsingMachineRepository` via Prisma `$queryRaw` (Postgres `generate_series` + `COUNT FILTER`); expose `GET /machine/stats/sessions/daily` behind `AdminGuard` on `MachineController`.

**Tech Stack:** NestJS 11, Prisma 7 (`$queryRaw`), PostgreSQL, class-validator, Jest.

## Global Constraints

- No Prisma schema / migration changes
- Registered = current `user_uuid IS NOT NULL`; unregistered = `NULL`
- Day bucket = KST (`Asia/Seoul`) from `started_at`
- Include every calendar day in `[from, to]` with `0`/`0` when empty
- Max inclusive span **90 days**
- Auth: `AdminGuard` only
- `started_at` column is `TIMESTAMP(3)` **without** time zone (UTC wall time as stored by Prisma) — treat as UTC when converting to KST
- Code/comments English; talk to user in Korean

## File Structure

| File | Responsibility |
|---|---|
| `src/machine/dto/req/get-daily-session-stats-req.dto.ts` | Query validation (`from`, `to`, order, span) |
| `src/machine/dto/req/get-daily-session-stats-req.dto.spec.ts` | DTO unit tests |
| `src/machine/dto/res/get-daily-session-stats-res.dto.ts` | Response Swagger shape |
| `libs/database/src/repositories/using-machine.repository.ts` | `$queryRaw` daily aggregate |
| `src/machine/machine.service.ts` | `getDailySessionStats(from, to)` |
| `src/machine/machine.service.spec.ts` | Service unit tests (mocked repo) |
| `src/machine/machine.controller.ts` | Admin GET route (before `/:uuid`) |
| `test/machine-usage.integration-spec.ts` | Optional PG integration cases for SQL/KST (extend if `MACHINE_USAGE_TEST_DATABASE_URL` available) |

---

### Task 1: Request DTO + validation tests

**Files:**
- Create: `src/machine/dto/req/get-daily-session-stats-req.dto.ts`
- Create: `src/machine/dto/req/get-daily-session-stats-req.dto.spec.ts`

**Interfaces:**
- Produces: `GetDailySessionStatsReqDto` with `from: string`, `to: string` (`YYYY-MM-DD`)

- [ ] **Step 1: Write the failing DTO tests**

```typescript
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetDailySessionStatsReqDto } from './get-daily-session-stats-req.dto';

describe('GetDailySessionStatsReqDto', () => {
  it('accepts a valid inclusive range within 90 days', async () => {
    const dto = plainToInstance(GetDailySessionStatsReqDto, {
      from: '2026-11-01',
      to: '2026-11-10',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a single-day range', async () => {
    const dto = plainToInstance(GetDailySessionStatsReqDto, {
      from: '2026-11-11',
      to: '2026-11-11',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    { from: '2026-11-10', to: '2026-11-09' },
    { from: '2026-01-01', to: '2026-04-02' }, // 92 days inclusive
    { from: '11-01-2026', to: '2026-11-10' },
    { from: '2026-11-01', to: undefined },
    { from: undefined, to: '2026-11-10' },
  ])('rejects invalid range: %j', async (query) => {
    expect(
      await validate(plainToInstance(GetDailySessionStatsReqDto, query)),
    ).not.toHaveLength(0);
  });

  it('accepts exactly 90 inclusive days', async () => {
    const dto = plainToInstance(GetDailySessionStatsReqDto, {
      from: '2026-01-01',
      to: '2026-03-31', // 90 days
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- src/machine/dto/req/get-daily-session-stats-req.dto.spec.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement the DTO**

```typescript
import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  Matches,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_INCLUSIVE_DAYS = 90;

@ValidatorConstraint({ name: 'dailySessionStatsRange', async: false })
export class DailySessionStatsRangeConstraint
  implements ValidatorConstraintInterface
{
  validate(_: unknown, args: ValidationArguments): boolean {
    const { from, to } = args.object as GetDailySessionStatsReqDto;
    if (!DATE_RE.test(from ?? '') || !DATE_RE.test(to ?? '')) return false;
    if (from > to) return false;
    const fromMs = Date.parse(`${from}T00:00:00+09:00`);
    const toMs = Date.parse(`${to}T00:00:00+09:00`);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return false;
    const inclusiveDays = (toMs - fromMs) / 86_400_000 + 1;
    return inclusiveDays <= MAX_INCLUSIVE_DAYS;
  }

  defaultMessage(): string {
    return `to must be on or after from, and the inclusive range must be at most ${MAX_INCLUSIVE_DAYS} days`;
  }
}

export class GetDailySessionStatsReqDto {
  @ApiProperty({
    description: 'Inclusive KST start date (YYYY-MM-DD)',
    example: '2026-11-01',
  })
  @IsNotEmpty()
  @Matches(DATE_RE)
  from: string;

  @ApiProperty({
    description: 'Inclusive KST end date (YYYY-MM-DD)',
    example: '2026-11-10',
  })
  @IsNotEmpty()
  @Matches(DATE_RE)
  @Validate(DailySessionStatsRangeConstraint)
  to: string;
}
```

Note: `2026-01-01` → `2026-03-31` is 90 inclusive days; `2026-01-01` → `2026-04-02` is 92. Adjust the “exactly 90” fixture if calendar math differs — assert with the same formula used in the constraint.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- src/machine/dto/req/get-daily-session-stats-req.dto.spec.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/machine/dto/req/get-daily-session-stats-req.dto.ts \
  src/machine/dto/req/get-daily-session-stats-req.dto.spec.ts
git commit -m "$(cat <<'EOF'
feat: add daily session stats request DTO validation

EOF
)"
```

---

### Task 2: Response DTO + repository aggregate

**Files:**
- Create: `src/machine/dto/res/get-daily-session-stats-res.dto.ts`
- Modify: `libs/database/src/repositories/using-machine.repository.ts`
- Modify: `test/machine-usage.integration-spec.ts` (add describe block; skip-safe if env already required)

**Interfaces:**
- Consumes: `from: string`, `to: string` (`YYYY-MM-DD`)
- Produces: `UsingMachineRepository.countDailySessionsByRegistration(from, to): Promise<Array<{ date: string; registeredCount: number; unregisteredCount: number }>>`

- [ ] **Step 1: Add response DTO**

```typescript
import { ApiProperty } from '@nestjs/swagger';

export class GetDailySessionStatsResDto {
  @ApiProperty({ example: '2026-11-10', description: 'KST calendar date' })
  date: string;

  @ApiProperty({ example: 12 })
  registeredCount: number;

  @ApiProperty({ example: 34 })
  unregisteredCount: number;
}
```

- [ ] **Step 2: Write failing integration test** (append inside existing suite after `usages` is ready)

```typescript
describe('daily session registration stats', () => {
  it('buckets by KST day, fills gaps, and splits registered vs unregistered', async () => {
    const machine = await machines.createMachine({
      // use whatever create helper exists; otherwise raw prisma insert
    });
    // Prefer prisma.usingMachine.create with fixed startedAt:
    // - 2026-11-09T15:30:00.000Z → KST 2026-11-10 00:30 → registered
    // - 2026-11-10T14:59:59.000Z → KST 2026-11-10 23:59 → unregistered
    // - 2026-11-11T15:00:00.000Z → KST 2026-11-12 00:00 → registered
    // Range from=2026-11-10 to=2026-11-12 → middle day empty? 
    // Actually day 11 KST empty if no session in [2026-11-10T15:00Z, 2026-11-11T15:00Z)

    await prisma.usingMachine.createMany({
      data: [
        {
          machineUuid,
          userUuid,
          startedAt: new Date('2026-11-09T15:30:00.000Z'),
          endedAt: new Date('2026-11-09T16:00:00.000Z'),
        },
        {
          machineUuid,
          userUuid: null,
          startedAt: new Date('2026-11-10T14:59:59.000Z'),
          endedAt: new Date('2026-11-10T15:30:00.000Z'),
        },
        {
          machineUuid,
          userUuid,
          startedAt: new Date('2026-11-11T15:00:00.000Z'),
          endedAt: new Date('2026-11-11T16:00:00.000Z'),
        },
      ],
    });

    const rows = await usages.countDailySessionsByRegistration(
      '2026-11-10',
      '2026-11-12',
    );

    expect(rows).toEqual([
      { date: '2026-11-10', registeredCount: 1, unregisteredCount: 1 },
      { date: '2026-11-11', registeredCount: 0, unregisteredCount: 0 },
      { date: '2026-11-12', registeredCount: 1, unregisteredCount: 0 },
    ]);
  });
});
```

If `createMany` / null `userUuid` conflicts with existing open-session unique index, end prior open sessions first or use finished rows only (`endedAt` set) as above.

- [ ] **Step 3: Run integration test to verify it fails**

Run: `bun run test:machine-usage`  
(Requires `MACHINE_USAGE_TEST_DATABASE_URL`)

Expected: FAIL — `countDailySessionsByRegistration` not a function

If the env DB is unavailable in this environment, write a focused unit test that asserts the repository method calls `$queryRaw` and maps bigint/number fields; still implement the real SQL next.

- [ ] **Step 4: Implement repository method**

Add to `UsingMachineRepository`:

```typescript
async countDailySessionsByRegistration(
  from: string,
  to: string,
): Promise<
  Array<{
    date: string;
    registeredCount: number;
    unregisteredCount: number;
  }>
> {
  const rows = await this.databaseService
    .$queryRaw<
      Array<{
        date: string;
        registeredCount: bigint | number;
        unregisteredCount: bigint | number;
      }>
    >`
      WITH days AS (
        SELECT generate_series(
          ${from}::date,
          ${to}::date,
          interval '1 day'
        )::date AS day
      ),
      stats AS (
        SELECT
          ((started_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date AS day,
          COUNT(*) FILTER (WHERE user_uuid IS NOT NULL) AS registered_count,
          COUNT(*) FILTER (WHERE user_uuid IS NULL) AS unregistered_count
        FROM using_machine
        WHERE started_at >= (${from}::date - interval '9 hours')
          AND started_at < (${to}::date + interval '1 day' - interval '9 hours')
          AND ended_at IS NOT NULL
          AND (EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)
            >= ${MACHINE_REREGISTRATION_MIN_DURATION_MS}
        GROUP BY 1
      )
      SELECT
        to_char(d.day, 'YYYY-MM-DD') AS date,
        COALESCE(s.registered_count, 0) AS "registeredCount",
        COALESCE(s.unregistered_count, 0) AS "unregisteredCount"
      FROM days d
      LEFT JOIN stats s ON s.day = d.day
      ORDER BY d.day
    `
    .catch((error) => {
      this.logger.error(
        `countDailySessionsByRegistration error: ${String(error)}`,
      );
      throw new InternalServerErrorException('Database Error');
    });

  return rows.map((row) => ({
    date: row.date,
    registeredCount: Number(row.registeredCount),
    unregisteredCount: Number(row.unregisteredCount),
  }));
}
```

**Timezone note:** `started_at` is `TIMESTAMP(3)` without tz. Prisma writes UTC components.  
- Day expression: `(started_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul'`  
- Range bounds: `${from}::timestamp AT TIME ZONE 'Asia/Seoul'` interprets the naive `YYYY-MM-DD 00:00:00` as KST and yields timestamptz; comparing to `timestamp without time zone` may coerce — if integration tests show off-by-one, switch bounds to UTC-naive equivalents:

```sql
WHERE started_at >= (${from}::date - interval '9 hours')
  AND started_at < (${to}::date + interval '1 day' - interval '9 hours')
```

…or compare using the same KST cast on both sides. Prefer whatever the integration test proves correct; do not change the schema.

- [ ] **Step 5: Run integration (or unit) test to verify pass**

Run: `bun run test:machine-usage`  
Expected: PASS for the new describe block

- [ ] **Step 6: Commit**

```bash
git add src/machine/dto/res/get-daily-session-stats-res.dto.ts \
  libs/database/src/repositories/using-machine.repository.ts \
  test/machine-usage.integration-spec.ts
git commit -m "$(cat <<'EOF'
feat: aggregate daily registered and unregistered machine sessions

EOF
)"
```

---

### Task 3: Service + controller wiring

**Files:**
- Modify: `src/machine/machine.service.ts`
- Modify: `src/machine/machine.service.spec.ts`
- Modify: `src/machine/machine.controller.ts`

**Interfaces:**
- Consumes: `UsingMachineRepository.countDailySessionsByRegistration(from, to)`
- Produces: `MachineService.getDailySessionStats(from, to)` → same row array; `GET /machine/stats/sessions/daily`

- [ ] **Step 1: Write failing service test**

In `machine.service.spec.ts`, extend the existing mock setup:

```typescript
describe('getDailySessionStats', () => {
  it('delegates to UsingMachineRepository', async () => {
    const rows = [
      { date: '2026-11-10', registeredCount: 1, unregisteredCount: 2 },
    ];
    usingMachineRepository.countDailySessionsByRegistration = jest
      .fn()
      .mockResolvedValue(rows);

    await expect(
      service.getDailySessionStats('2026-11-10', '2026-11-10'),
    ).resolves.toEqual(rows);
    expect(
      usingMachineRepository.countDailySessionsByRegistration,
    ).toHaveBeenCalledWith('2026-11-10', '2026-11-10');
  });
});
```

Ensure the test module’s `UsingMachineRepository` mock includes `countDailySessionsByRegistration: jest.fn()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/machine/machine.service.spec.ts -t getDailySessionStats`

Expected: FAIL — method missing

- [ ] **Step 3: Implement service method**

```typescript
async getDailySessionStats(
  from: string,
  to: string,
): Promise<
  Array<{
    date: string;
    registeredCount: number;
    unregisteredCount: number;
  }>
> {
  return this.usingMachineRepository.countDailySessionsByRegistration(
    from,
    to,
  );
}
```

- [ ] **Step 4: Add controller route** near other static paths (e.g. after `summary`, **before** any `@Get(':uuid...')`)

```typescript
@Get('stats/sessions/daily')
@ApiOperation({
  summary: 'Daily registered vs unregistered session counts',
  description:
    'Returns per-KST-day counts of UsingMachine sessions started in the range. Empty days are included as zeros. Admin only.',
})
@ApiBearerAuth('user')
@UseGuards(AdminGuard)
@ApiOkResponse({ type: GetDailySessionStatsResDto, isArray: true })
async getDailySessionStats(
  @Query() query: GetDailySessionStatsReqDto,
): Promise<GetDailySessionStatsResDto[]> {
  return this.machineService.getDailySessionStats(query.from, query.to);
}
```

Import the new DTOs at the top of the controller.

- [ ] **Step 5: Run service tests**

Run: `bun run test -- src/machine/machine.service.spec.ts -t getDailySessionStats`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/machine/machine.service.ts \
  src/machine/machine.service.spec.ts \
  src/machine/machine.controller.ts
git commit -m "$(cat <<'EOF'
feat: expose admin daily session stats endpoint

EOF
)"
```

---

### Task 4: Verify

- [ ] **Step 1: Run DTO + service unit tests**

Run:

```bash
bun run test -- \
  src/machine/dto/req/get-daily-session-stats-req.dto.spec.ts \
  src/machine/machine.service.spec.ts
```

Expected: PASS

- [ ] **Step 2: Lint touched files**

Run: `bun run lint`

Expected: no new errors in touched files

- [ ] **Step 3: (Optional) integration**

Run: `bun run test:machine-usage` when `MACHINE_USAGE_TEST_DATABASE_URL` is set

Expected: PASS including daily stats cases

- [ ] **Step 4: Final commit only if verify left uncommitted fixes**

```bash
git status
# commit any lint/test fixes if present
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Admin GET daily stats | Task 3 |
| `from`/`to` YYYY-MM-DD, ≤90 days | Task 1 |
| `started_at` KST buckets | Task 2 |
| registered / unregistered by current `user_uuid` | Task 2 |
| Fill empty days with 0/0 | Task 2 (`generate_series`) |
| No schema change | All tasks |
| DTO + KST/gap tests | Tasks 1–2, 4 |

## Placeholder / type consistency check

- Method name consistent: `countDailySessionsByRegistration` / `getDailySessionStats`
- Response fields: `date`, `registeredCount`, `unregisteredCount`
- No TBD/TODO left in steps
