# Daily Registered / Unregistered Session Stats Design

**Date:** 2026-11-11  
**Status:** Approved  
**Context:** Admin needs per-day counts of machine usage sessions that are registered vs unregistered, without schema changes.

## Goal

Add an admin endpoint that returns, for each calendar day in a requested range, how many `UsingMachine` sessions started that day were registered (`user_uuid` set) vs unregistered (`user_uuid` null).

## Non-goals

- Prisma schema / migration changes
- Snapshotting registration state at session start
- Stats for auth refresh sessions or push devices
- Non-admin access

## Semantics

| Rule | Choice |
|---|---|
| Session source | `using_machine` rows |
| Duration filter | Completed only (`ended_at IS NOT NULL`) and `ended_at - started_at >= 30 minutes` (`MACHINE_REREGISTRATION_MIN_DURATION_MS`) |
| Registered | current `user_uuid IS NOT NULL` |
| Unregistered | current `user_uuid IS NULL` |
| Day bucket | KST (`Asia/Seoul`), based on `started_at` |
| Empty days | Include every day in `[from, to]` with `0` / `0` |

Mid-session register/unregister changes the current `user_uuid`; that final/current value is what is counted. No DB change is required for this.

## API

`GET /machine/stats/sessions/daily`

- Auth: `AdminGuard` + `@ApiBearerAuth('user')`
- Place route **before** `/:uuid` handlers to avoid path capture

### Query

| Param | Required | Format | Notes |
|---|---|---|---|
| `from` | yes | `YYYY-MM-DD` | Inclusive KST start date |
| `to` | yes | `YYYY-MM-DD` | Inclusive KST end date |

Validation:

- Both parse as calendar dates
- `from <= to`
- Max span **90 days** (inclusive) to bound query cost → `400 Bad Request` otherwise

### Response

Array, ascending by `date`:

```json
[
  {
    "date": "2026-11-10",
    "registeredCount": 12,
    "unregisteredCount": 34
  }
]
```

Length equals number of calendar days from `from` through `to` inclusive.

## Approach

Prisma `$queryRaw` with PostgreSQL `generate_series` + left join aggregate (no schema change).

1. Build KST day series from `from` through `to`.
2. Aggregate sessions where `started_at` falls in that KST day range and duration is at least 30 minutes with `ended_at` set.
3. Split counts with `COUNT(*) FILTER (WHERE user_uuid IS NOT NULL)` / `IS NULL`.
4. Left-join so days with no sessions still return zeros.

Approximate SQL shape:

```sql
WITH days AS (
  SELECT generate_series(
    ${from}::date,
    ${to}::date,
    '1 day'::interval
  )::date AS day
),
stats AS (
  SELECT
    ((started_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date AS day,
    COUNT(*) FILTER (WHERE user_uuid IS NOT NULL)::int AS registered_count,
    COUNT(*) FILTER (WHERE user_uuid IS NULL)::int AS unregistered_count
  FROM using_machine
  WHERE started_at >= (${from}::timestamp AT TIME ZONE 'Asia/Seoul')
    AND started_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Seoul')
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
ORDER BY d.day;
```

(Exact timezone cast style must match how Prisma/Postgres stores `timestamptz` in this project; verify against existing `started_at` storage.)

## Components

| Piece | Responsibility |
|---|---|
| `GetDailySessionStatsReqDto` | Validate `from` / `to`, span ≤ 90 days |
| `GetDailySessionStatsResDto` | Swagger response shape |
| `MachineController` | Admin GET route |
| `MachineService` | Pass-through / thin orchestration |
| `UsingMachineRepository.countDailySessionsByRegistration` | `$queryRaw` query |

## Failure handling

- Invalid / missing dates, `from > to`, span > 90 → `400`
- Non-admin → existing `AdminGuard` behavior (`401` / `403`)
- DB errors → existing repository pattern (`500` + log)

## Testing

- Unit/DTO: `from > to` and span > 90 rejected
- Repository or service-level: given fixtures on two KST days (and one empty day in between), response includes all three days with correct registered/unregistered counts
- Confirm KST midnight boundary: a UTC timestamp that falls on the previous/next KST calendar day is bucketed correctly
