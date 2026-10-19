import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  Gender,
  Location,
  MachineType,
} from 'generated/prisma/client';
import { UsingMachineRepository } from '@lib/database/repositories/using-machine.repository';
import { MachineRepository } from '@lib/database/repositories/machine.repository';
import type { DatabaseService } from '@lib/database/database.service';

jest.mock('@gsainfoteam/nest-observability', () => ({
  Trace: () => (target: unknown) => target,
}));
jest.mock('@lib/logger', () => ({
  Loggable: () => (target: unknown) => target,
}));
jest.mock('@lib/database/database.service', () => ({}));

const connectionString = process.env.MACHINE_USAGE_TEST_DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'Set MACHINE_USAGE_TEST_DATABASE_URL to a local PostgreSQL test database.',
  );
}

describe('Machine usage history (PostgreSQL)', () => {
  const schema = `usage_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString });
  const machineUuid = randomUUID();
  const idleMachineUuid = randomUUID();
  const userUuid = randomUUID();
  const otherUserUuid = randomUUID();
  const legacyUsageUuid = randomUUID();
  const legacyIdleUsageUuid = randomUUID();
  let prisma: PrismaClient;
  let usages: UsingMachineRepository;
  let machines: MachineRepository;

  beforeAll(async () => {
    const client = await admin.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      const migrationRoot = resolve(__dirname, '../prisma/migrations');
      const migrationName = '20261020000000_preserve_machine_usage_history';
      for (const migration of readdirSync(migrationRoot).sort()) {
        if (migration === 'migration_lock.toml' || migration === migrationName)
          continue;
        await client.query(
          readFileSync(
            resolve(migrationRoot, migration, 'migration.sql'),
            'utf8',
          ),
        );
      }
      for (const uuid of [userUuid, otherUserUuid]) {
        await client.query(
          `INSERT INTO "user" (uuid, name, email, student_number, gender, updated_at)
           VALUES ($1::uuid, 'test', 'test@example.com', $1::text, 'MALE', NOW())`,
          [uuid],
        );
      }
      for (const [uuid, index, status] of [
        [machineUuid, 1, 'WASH'],
        [idleMachineUuid, 2, 'IDLE'],
      ]) {
        await client.query(
          `INSERT INTO machine (uuid, type, location, gender, index, status, updated_at)
           VALUES ($1, 'WASHER', 'A', 'MALE', $2, $3::"MachineStatus", NOW())`,
          [uuid, index, status],
        );
      }
      for (const [uuid, machine] of [
        [legacyUsageUuid, machineUuid],
        [legacyIdleUsageUuid, idleMachineUuid],
      ]) {
        await client.query(
          `INSERT INTO using_machine (uuid, machine_uuid, user_uuid, started_at)
           VALUES ($1, $2, $3, NOW() - INTERVAL '1 hour')`,
          [uuid, machine, userUuid],
        );
      }
      await client.query(
        readFileSync(
          resolve(migrationRoot, migrationName, 'migration.sql'),
          'utf8',
        ),
      );
    } finally {
      client.release();
    }
    prisma = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString, options: `-c search_path=${schema}` },
        { schema },
      ),
    });
    usages = new UsingMachineRepository(prisma as DatabaseService);
    machines = new MachineRepository(prisma as DatabaseService);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });

  it('preserves legacy rows and closes only idle machine records', async () => {
    const running = await prisma.usingMachine.findUniqueOrThrow({
      where: { uuid: legacyUsageUuid },
    });
    const idle = await prisma.usingMachine.findUniqueOrThrow({
      where: { uuid: legacyIdleUsageUuid },
    });
    expect(running).toMatchObject({ userUuid, endedAt: null });
    expect(idle.userUuid).toBe(userUuid);
    expect(idle.endedAt!.getTime()).toBeGreaterThanOrEqual(
      idle.startedAt.getTime(),
    );
    expect(
      await usages.getUsingMachineByMachineUuid(idleMachineUuid),
    ).toBeNull();
  });

  it('keeps an existing session intact when start events arrive concurrently', async () => {
    const original = await usages.getUsingMachineByMachineUuid(machineUuid);
    const results = await Promise.all([
      usages.createUsingMachine(machineUuid, otherUserUuid, false),
      usages.createUsingMachine(machineUuid),
    ]);
    expect(results).toEqual([original, original]);
  });

  it('accumulates separate sessions for different users on the same machine', async () => {
    const finishes = await Promise.all([
      usages.finishUsingMachine(machineUuid),
      usages.finishUsingMachine(machineUuid),
    ]);
    expect(finishes.filter(Boolean)).toHaveLength(1);
    const finished = finishes.find(Boolean)!;
    expect(finished).toMatchObject({ uuid: legacyUsageUuid, userUuid });
    expect(finished.endedAt).toBeInstanceOf(Date);

    const starts = await Promise.all([
      usages.createUsingMachine(machineUuid, otherUserUuid),
      usages.createUsingMachine(machineUuid, otherUserUuid),
    ]);
    expect(starts[0]).toEqual(starts[1]);
    expect(starts[0].uuid).not.toBe(legacyUsageUuid);
    expect(await usages.getUsingMachinesByUser(userUuid)).toEqual([]);
    expect(await usages.getUsingMachinesByUser(otherUserUuid)).toEqual([
      starts[0],
    ]);
    expect(
      (await machines.getMachineWithUsage(machineUuid))?.currentUsage,
    ).toEqual(starts[0]);

    await usages.finishUsingMachine(machineUuid);
    expect(await prisma.usingMachine.count({ where: { machineUuid } })).toBe(2);
    expect(
      await usages.getUsageHistoryByUser(otherUserUuid, 20, 0),
    ).toHaveLength(1);
    expect(await usages.getUsageHistoryByUser(userUuid, 1, 0)).toHaveLength(1);
    expect(await usages.getUsageHistoryByUser(userUuid, 1, 1)).toHaveLength(1);
  });

  it('never updates closed records when registering, toggling or unregistering', async () => {
    const before = await prisma.usingMachine.findMany({
      where: { machineUuid },
    });
    expect(await usages.enableMachineNotification(userUuid, machineUuid)).toBe(
      0,
    );
    expect(await usages.disableMachineNotification(userUuid, machineUuid)).toBe(
      0,
    );
    expect(await usages.unlinkUserFromUsingMachine(userUuid, machineUuid)).toBe(
      0,
    );
    expect(
      await prisma.usingMachine.findMany({ where: { machineUuid } }),
    ).toEqual(before);
    expect(
      (await machines.getMachineWithUsage(machineUuid))?.currentUsage,
    ).toBeNull();
    expect(
      await machines.getLaundryRoomStatusByRoom(Gender.MALE),
    ).toContainEqual({
      location: Location.A,
      gender: Gender.MALE,
      type: MachineType.WASHER,
      unusedCount: 2,
    });
  });

  it('creates idle machines without placeholder usage records', async () => {
    const machine = await machines.createMachine({
      location: Location.B,
      gender: Gender.MALE,
      type: MachineType.WASHER,
      index: 1,
    });
    expect(
      (await machines.getMachineWithUsage(machine.uuid))?.currentUsage,
    ).toBeNull();
    const multiple = await machines.createMultipleMachines({
      location: Location.B,
      gender: Gender.MALE,
      type: MachineType.WASHER,
      startIndex: 2,
      endIndex: 3,
    });
    expect(
      await prisma.usingMachine.count({
        where: { machineUuid: { in: multiple.map((item) => item.uuid) } },
      }),
    ).toBe(0);
  });

  it('enforces one active session and protects history from machine deletion', async () => {
    await usages.createUsingMachine(machineUuid);
    await expect(
      prisma.usingMachine.create({ data: { machineUuid } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(machines.deleteMachine(machineUuid)).rejects.toThrow(
      'Machine with usage history cannot be deleted.',
    );
    await usages.finishUsingMachine(machineUuid);
  });
});
