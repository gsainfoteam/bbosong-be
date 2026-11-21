import { Loggable } from '@lib/logger';
import {
  ConflictException,
  HttpException,
  NotFoundException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '@lib/database/database.service';
import {
  Gender,
  Location,
  MachineType,
  Prisma,
  UsingMachine,
} from 'generated/prisma/client';
import { MACHINE_REREGISTRATION_MIN_DURATION_MS } from '../constants/machine-registration';
import { Trace } from '@gsainfoteam/nest-observability';
import type { UsingMachineWithThinq } from '../types/machine.type';

export type UsageStatsDimension =
  'date' | 'weekday' | 'hour' | 'location' | 'gender';

// Whitelisted SQL expressions (KST-based); never built from user input.
const USAGE_DIMENSION_SQL: Record<UsageStatsDimension, string> = {
  date: `to_char((us.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')`,
  weekday: `EXTRACT(ISODOW FROM (us.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::int`,
  hour: `EXTRACT(HOUR FROM (us.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::int`,
  location: 'm.location::text',
  gender: 'm.gender::text',
};
const USAGE_DIMENSION_ORDER = Object.keys(
  USAGE_DIMENSION_SQL,
) as UsageStatsDimension[];

export interface UsageStatsRow {
  date?: string;
  weekday?: number;
  hour?: number;
  location?: Location;
  gender?: Gender;
  sessionCount: number;
}

export interface DailySessionFilter {
  location?: Location;
  gender?: Gender;
  type?: MachineType;
}

@Loggable()
@Injectable()
@Trace()
export class UsingMachineRepository {
  private readonly logger = new Logger(UsingMachineRepository.name);
  constructor(private readonly databaseService: DatabaseService) {}

  // Start a new session; repeated start events preserve the existing session.
  async createUsingMachine(
    machineUuid: string,
    userUuid?: string,
    notifyOnCompletion = true,
  ): Promise<UsingMachine> {
    return await this.databaseService
      .$transaction(async (tx) => {
        // Serialize lifecycle changes across processes, including retries.
        const machines = await tx.$queryRaw<{ uuid: string }[]>`
          SELECT "uuid" FROM "machine"
          WHERE "uuid" = ${machineUuid}::uuid AND "deleted_at" IS NULL
          FOR UPDATE
        `;
        if (!machines.length) throw new NotFoundException('Machine not found.');
        const activeUsage = await tx.usingMachine.findFirst({
          where: { machineUuid, endedAt: null },
        });
        if (activeUsage) return activeUsage;

        return tx.usingMachine.create({
          data: {
            machineUuid,
            userUuid: userUuid ?? null,
            notifyOnCompletion,
          },
        });
      })
      .catch((error) => {
        if (error instanceof HttpException) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `createUsingMachine prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`createUsingMachine error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  // Get only open sessions linked to a user
  async getUsingMachinesByUser(
    userUuid: string,
  ): Promise<UsingMachineWithThinq[]> {
    return await this.databaseService.usingMachine
      .findMany({
        where: { userUuid, endedAt: null, machine: { deletedAt: null } },
        orderBy: [{ startedAt: 'desc' }, { uuid: 'desc' }],
        include: {
          machine: {
            select: { thinqRemainingMinutes: true, thinqUpdatedAt: true },
          },
        },
      })
      .then((usages) =>
        usages.map(({ machine, ...usage }) => ({
          ...usage,
          thinqRemainingMinutes: machine.thinqRemainingMinutes,
          thinqUpdatedAt: machine.thinqUpdatedAt,
        })),
      )
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `getUsingMachinesByUser prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`getUsingMachinesByUser error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  // Enable completion notification and link userUuid if non-member or matching user
  async enableMachineNotification(
    userUuid: string,
    machineUuid: string,
  ): Promise<number> {
    const result = await this.databaseService.usingMachine
      .updateMany({
        where: {
          machineUuid,
          machine: { deletedAt: null },
          endedAt: null,
          OR: [{ userUuid: null }, { userUuid: userUuid }],
        },
        data: {
          userUuid,
          notifyOnCompletion: true,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `enableMachineNotification prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`enableMachineNotification error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });

    return result.count;
  }

  // Lock both the machine lifecycle and the usage row (notification/unlink updates).
  async confirmCompletedAndRegister(
    userUuid: string,
    machineUuid: string,
    expectedUsageUuid: string,
  ): Promise<UsingMachine> {
    return this.databaseService
      .$transaction(async (tx) => {
        const machines = await tx.$queryRaw<{ uuid: string }[]>`
        SELECT "uuid" FROM "machine"
        WHERE "uuid" = ${machineUuid}::uuid AND "deleted_at" IS NULL
        FOR UPDATE
      `;
        if (!machines.length) throw new NotFoundException('Machine not found.');
        await tx.$queryRaw`
        SELECT "uuid" FROM "using_machine"
        WHERE "machine_uuid" = ${machineUuid}::uuid AND "ended_at" IS NULL
        FOR UPDATE
      `;
        const active = await tx.usingMachine.findFirst({
          where: { machineUuid, endedAt: null },
        });
        if (!active) {
          throw new NotFoundException({
            statusCode: 404,
            error: 'Not Found',
            message: 'Machine is not running.',
            errorCode: 'MACHINE_NOT_RUNNING',
          });
        }
        if (active.uuid !== expectedUsageUuid) {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            message: 'Machine usage has changed. Register again.',
            errorCode: 'MACHINE_USAGE_CHANGED',
          });
        }
        const now = new Date();
        if (
          !active.userUuid ||
          active.userUuid === userUuid ||
          now.getTime() - active.startedAt.getTime() <
            MACHINE_REREGISTRATION_MIN_DURATION_MS
        ) {
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            message: 'Machine cannot be re-registered yet.',
            errorCode: 'MACHINE_ALREADY_REGISTERED',
          });
        }
        // Retain ownership/start timestamp while making the previous duration zero.
        const previous = await tx.usingMachine.update({
          where: { uuid: active.uuid },
          data: { endedAt: active.startedAt, notifyOnCompletion: false },
        });
        await tx.usingMachine.create({
          data: {
            machineUuid,
            userUuid,
            startedAt: now,
            notifyOnCompletion: true,
          },
        });
        return previous;
      })
      .catch((error: unknown) => {
        if (error instanceof HttpException) throw error;
        this.logger.error(
          `confirmCompletedAndRegister error: ${String(error)}`,
        );
        throw new InternalServerErrorException('Database Error');
      });
  }

  // Disable completion notification for the operating user
  async disableMachineNotification(
    userUuid: string,
    machineUuid: string,
  ): Promise<number> {
    const result = await this.databaseService.usingMachine
      .updateMany({
        where: {
          machineUuid,
          machine: { deletedAt: null },
          endedAt: null,
          userUuid,
        },
        data: {
          notifyOnCompletion: false,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `disableMachineNotification prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`disableMachineNotification error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });

    return result.count;
  }

  // Get active usingMachine by machineUuid
  async getUsingMachineByMachineUuid(
    machineUuid: string,
  ): Promise<UsingMachine | null> {
    return await this.databaseService.usingMachine
      .findFirst({
        where: { machineUuid, endedAt: null, machine: { deletedAt: null } },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `getUsingMachineByMachineUuid prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`getUsingMachineByMachineUuid error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  // Most recently ended session of the user on the machine (any age).
  async getLatestEndedUsingMachineByUser(
    userUuid: string,
    machineUuid: string,
  ): Promise<UsingMachine | null> {
    return await this.databaseService.usingMachine
      .findFirst({
        where: {
          userUuid,
          machineUuid,
          endedAt: { not: null },
          machine: { deletedAt: null },
        },
        orderBy: [{ endedAt: 'desc' }, { uuid: 'desc' }],
      })
      .catch((error) => {
        this.logger.error(`getLatestEndedUsingMachineByUser error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  // Close and return the session atomically, retaining its user and timestamps.
  async finishUsingMachine(machineUuid: string): Promise<UsingMachine | null> {
    return this.databaseService
      .$transaction(async (tx) => {
        const machines = await tx.$queryRaw<{ uuid: string }[]>`
          SELECT "uuid" FROM "machine"
          WHERE "uuid" = ${machineUuid}::uuid AND "deleted_at" IS NULL
          FOR UPDATE
        `;
        if (!machines.length) return null;
        const finished = await tx.usingMachine.updateManyAndReturn({
          where: { machineUuid, endedAt: null },
          data: { endedAt: new Date() },
        });
        return finished[0] ?? null;
      })
      .catch((error) => {
        this.logger.error(`finishUsingMachine error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  async getUsageHistoryByUser(
    userUuid: string,
    limit: number,
    offset: number,
  ): Promise<UsingMachine[]> {
    return this.databaseService.usingMachine
      .findMany({
        where: {
          userUuid,
          endedAt: { not: null },
          machine: { deletedAt: null },
        },
        orderBy: [{ startedAt: 'desc' }, { uuid: 'desc' }],
        take: limit,
        skip: offset,
      })
      .catch((error) => {
        this.logger.error(`getUsageHistoryByUser error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  // Unlink user from usingMachine (set userUuid to null and disable notification)
  async unlinkUserFromUsingMachine(
    userUuid: string,
    machineUuid: string,
  ): Promise<number> {
    const result = await this.databaseService.usingMachine
      .updateMany({
        where: {
          machineUuid,
          machine: { deletedAt: null },
          endedAt: null,
          userUuid,
        },
        data: {
          userUuid: null,
          notifyOnCompletion: false,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `unlinkUserFromUsingMachine prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`unlinkUserFromUsingMachine error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });

    return result.count;
  }

  // Optional filters narrow sessions by their machine's laundry room attributes.
  // Omitted filters match all machines.
  async countDailySessionsByRegistration(
    from: string,
    to: string,
    filter: DailySessionFilter = {},
  ): Promise<
    Array<{
      date: string;
      registeredCount: number;
      unregisteredCount: number;
    }>
  > {
    const rows = await this.databaseService.$queryRaw<
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
          ((us.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')::date AS day,
          COUNT(*) FILTER (WHERE us.user_uuid IS NOT NULL) AS registered_count,
          COUNT(*) FILTER (WHERE us.user_uuid IS NULL) AS unregistered_count
        FROM using_machine us
        JOIN machine m ON m.uuid = us.machine_uuid
        WHERE us.started_at >= (${from}::date - interval '9 hours')
          AND us.started_at < (${to}::date + interval '1 day' - interval '9 hours')
          AND us.ended_at IS NOT NULL
          AND (EXTRACT(EPOCH FROM (us.ended_at - us.started_at)) * 1000)
            >= ${MACHINE_REREGISTRATION_MIN_DURATION_MS}
          AND m.location = COALESCE(${filter.location ?? null}::location, m.location)
          AND m.gender = COALESCE(${filter.gender ?? null}::gender, m.gender)
          AND m.type = COALESCE(${filter.type ?? null}::machine_type, m.type)
        GROUP BY 1
      )
      SELECT
        to_char(d.day, 'YYYY-MM-DD') AS date,
        COALESCE(s.registered_count, 0) AS "registeredCount",
        COALESCE(s.unregistered_count, 0) AS "unregisteredCount"
      FROM days d
      LEFT JOIN stats s ON s.day = d.day
      ORDER BY d.day
    `.catch((error) => {
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

  // Counts qualifying sessions (completed, >= minimum duration) grouped by the
  // requested dimensions. Only groups that have sessions are returned.
  async countUsageStats(
    from: string,
    to: string,
    groupBy: UsageStatsDimension[] = [],
    filter: DailySessionFilter = {},
  ): Promise<UsageStatsRow[]> {
    const dims = USAGE_DIMENSION_ORDER.filter((d) => groupBy.includes(d));
    const select = Prisma.join(
      [
        ...dims.map((d) => Prisma.raw(`${USAGE_DIMENSION_SQL[d]} AS "${d}"`)),
        Prisma.raw('COUNT(*) AS "sessionCount"'),
      ],
      ', ',
    );
    const ordinals = Prisma.raw(dims.map((_, i) => i + 1).join(', '));
    const grouping = dims.length
      ? Prisma.sql`GROUP BY ${ordinals} ORDER BY ${ordinals}`
      : Prisma.empty;

    const rows = await this.databaseService.$queryRaw<
      Array<Record<string, string | number | bigint>>
    >`
      SELECT ${select}
      FROM using_machine us
      JOIN machine m ON m.uuid = us.machine_uuid
      WHERE us.started_at >= (${from}::date - interval '9 hours')
        AND us.started_at < (${to}::date + interval '1 day' - interval '9 hours')
        AND us.ended_at IS NOT NULL
        AND (EXTRACT(EPOCH FROM (us.ended_at - us.started_at)) * 1000)
          >= ${MACHINE_REREGISTRATION_MIN_DURATION_MS}
        AND m.location = COALESCE(${filter.location ?? null}::location, m.location)
        AND m.gender = COALESCE(${filter.gender ?? null}::gender, m.gender)
        AND m.type = COALESCE(${filter.type ?? null}::machine_type, m.type)
      ${grouping}
    `.catch((error) => {
      this.logger.error(`countUsageStats error: ${String(error)}`);
      throw new InternalServerErrorException('Database Error');
    });

    return rows.map((row) => ({
      ...row,
      ...(dims.includes('weekday') && { weekday: Number(row.weekday) }),
      ...(dims.includes('hour') && { hour: Number(row.hour) }),
      sessionCount: Number(row.sessionCount),
    }));
  }
}
