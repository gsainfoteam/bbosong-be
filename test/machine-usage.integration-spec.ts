import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  Gender,
  Location,
  Machine,
  MachineStatus,
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
  const thirdUserUuid = randomUUID();
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
      for (const uuid of [userUuid, otherUserUuid, thirdUserUuid]) {
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
    expect((await machines.getMachine(machineUuid))?.deletedAt).toBeNull();
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
    await expect(
      prisma.machine.delete({ where: { uuid: machineUuid } }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await usages.finishUsingMachine(machineUuid);
  });
  describe('completion confirmation', () => {
    let activeUuid: string;
    beforeEach(async () => {
      await usages.finishUsingMachine(machineUuid);
      const active = await usages.createUsingMachine(
        machineUuid,
        userUuid,
        false,
      );
      activeUuid = active.uuid;
      await prisma.usingMachine.update({
        where: { uuid: activeUuid },
        data: { startedAt: new Date(Date.now() - 31 * 60 * 1000) },
      });
    });

    it('preserves zero-duration history and starts a new user session', async () => {
      const previous = await usages.confirmCompletedAndRegister(
        otherUserUuid,
        machineUuid,
        activeUuid,
      );
      expect(previous).toMatchObject({ userUuid, notifyOnCompletion: false });
      expect(previous.endedAt).toEqual(previous.startedAt);
      const current = await usages.getUsingMachineByMachineUuid(machineUuid);
      expect(current).toMatchObject({
        userUuid: otherUserUuid,
        endedAt: null,
        notifyOnCompletion: true,
      });
      expect(current!.uuid).not.toBe(activeUuid);
      expect(current!.startedAt.getTime()).toBeGreaterThan(
        previous.startedAt.getTime(),
      );
      expect(
        await usages.getUsageHistoryByUser(userUuid, 100, 0),
      ).toContainEqual(previous);
      expect(await usages.getUsingMachinesByUser(userUuid)).toEqual([]);
    });

    it('allows only one simultaneous confirmation and rejects stale retries', async () => {
      const results = await Promise.allSettled([
        usages.confirmCompletedAndRegister(
          otherUserUuid,
          machineUuid,
          activeUuid,
        ),
        usages.confirmCompletedAndRegister(
          thirdUserUuid,
          machineUuid,
          activeUuid,
        ),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = results.find(
        (result) => result.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({
        response: { errorCode: 'MACHINE_USAGE_CHANGED' },
      });
      expect(
        await prisma.usingMachine.count({
          where: { machineUuid, endedAt: null },
        }),
      ).toBe(1);
      await expect(
        usages.confirmCompletedAndRegister(userUuid, machineUuid, activeUuid),
      ).rejects.toMatchObject({
        response: { errorCode: 'MACHINE_USAGE_CHANGED' },
      });
    });

    it('revalidates the duration and does not change short sessions', async () => {
      const active = await prisma.usingMachine.update({
        where: { uuid: activeUuid },
        data: { startedAt: new Date() },
      });
      await expect(
        usages.confirmCompletedAndRegister(
          otherUserUuid,
          machineUuid,
          activeUuid,
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'MACHINE_ALREADY_REGISTERED' },
      });
      expect(await usages.getUsingMachineByMachineUuid(machineUuid)).toEqual(
        active,
      );
    });

    it('rejects same-owner and unclaimed sessions', async () => {
      await expect(
        usages.confirmCompletedAndRegister(userUuid, machineUuid, activeUuid),
      ).rejects.toMatchObject({
        response: { errorCode: 'MACHINE_ALREADY_REGISTERED' },
      });
      await usages.unlinkUserFromUsingMachine(userUuid, machineUuid);
      await expect(
        usages.confirmCompletedAndRegister(
          otherUserUuid,
          machineUuid,
          activeUuid,
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'MACHINE_ALREADY_REGISTERED' },
      });
    });

    it('rolls back previous completion when new session creation fails', async () => {
      const before = await usages.getUsingMachineByMachineUuid(machineUuid);
      await expect(
        usages.confirmCompletedAndRegister(
          randomUUID(),
          machineUuid,
          activeUuid,
        ),
      ).rejects.toThrow('Database Error');
      expect(await usages.getUsingMachineByMachineUuid(machineUuid)).toEqual(
        before,
      );
    });

    it('rejects confirmation after normal completion', async () => {
      await usages.finishUsingMachine(machineUuid);
      await expect(
        usages.confirmCompletedAndRegister(
          otherUserUuid,
          machineUuid,
          activeUuid,
        ),
      ).rejects.toMatchObject({
        response: { errorCode: 'MACHINE_NOT_RUNNING' },
      });
    });
  });

  describe('machine soft delete', () => {
    let machine: Machine;
    const room = {
      location: Location.B,
      gender: Gender.FEMALE,
      type: MachineType.DRYER,
    };

    beforeEach(async () => {
      machine = await machines.createMachine({ ...room, index: 1 });
      machine = await machines.updateMachineShortUrl(
        machine.uuid,
        `https://test.example/${machine.uuid}`,
        machine.uuid,
      );
      await machines.updateMachineCommissioned(machine.uuid, machine.uuid);
      machine = (await machines.getMachine(machine.uuid))!;
    });

    afterEach(async () => {
      if (await machines.getMachine(machine.uuid)) {
        await machines.deleteMachine(machine.uuid);
      }
    });

    it('preserves machine, open/closed sessions and power but hides every read path', async () => {
      await usages.createUsingMachine(machine.uuid, userUuid);
      await usages.finishUsingMachine(machine.uuid);
      const active = await usages.createUsingMachine(machine.uuid, userUuid);
      await machines.recordMachinePowerByMacAddress(machine.macAddress!, 10);
      const sessions = await prisma.usingMachine.findMany({
        where: { machineUuid: machine.uuid },
        orderBy: { uuid: 'asc' },
      });
      const power = await machines.getMachinePowerFrom(machine.uuid);
      expect(power).toHaveLength(1);
      expect(await machines.getMachineWithUsage(machine.uuid)).toMatchObject({
        currentUsage: active,
      });

      await machines.deleteMachine(machine.uuid);

      const deleted = await prisma.machine.findUniqueOrThrow({
        where: { uuid: machine.uuid },
      });
      expect(deleted.deletedAt).toBeInstanceOf(Date);
      expect(deleted).toMatchObject({
        ...machine,
        deletedAt: expect.any(Date) as Date,
        updatedAt: expect.any(Date) as Date,
      });
      expect(
        await prisma.usingMachine.findMany({
          where: { machineUuid: machine.uuid },
          orderBy: { uuid: 'asc' },
        }),
      ).toEqual(sessions);
      expect(
        await prisma.machinePower.findMany({
          where: { machineUuid: machine.uuid },
        }),
      ).toEqual(power);

      expect(await machines.getMachines()).not.toContainEqual(
        expect.objectContaining({ uuid: machine.uuid }),
      );
      expect(await machines.getMachine(machine.uuid)).toBeNull();
      expect(await machines.getMachineWithUsage(machine.uuid)).toBeNull();
      expect(
        await machines.getMachineWithUsageByShortCode(machine.shortCode!),
      ).toBeNull();
      expect(
        await machines.getMachineTypeByMacAddress(machine.macAddress!),
      ).toBeNull();
      expect(await machines.getMachinePowerFrom(machine.uuid)).toEqual([]);
      expect(await machines.getLaundryRoomStatusByRoom(room.gender)).toEqual(
        [],
      );
      expect(
        await usages.getUsingMachineByMachineUuid(machine.uuid),
      ).toBeNull();
      for (const records of [
        await usages.getUsingMachinesByUser(userUuid),
        await usages.getUsageHistoryByUser(userUuid, 100, 0),
      ]) {
        expect(
          records.some((record) => record.machineUuid === machine.uuid),
        ).toBe(false);
      }
      await expect(machines.deleteMachine(machine.uuid)).rejects.toThrow(
        'Machine not found.',
      );
      await expect(machines.deleteMachine(randomUUID())).rejects.toThrow(
        'Machine not found.',
      );
    });

    it('excludes deleted idle machines from laundry room availability counts', async () => {
      expect(await machines.getLaundryRoomStatusByRoom(room.gender)).toEqual([
        { ...room, unusedCount: 1 },
      ]);
      await machines.deleteMachine(machine.uuid);
      expect(await machines.getLaundryRoomStatusByRoom(room.gender)).toEqual(
        [],
      );
    });

    it('blocks registration, lifecycle events and mutations after deletion', async () => {
      const active = await usages.createUsingMachine(machine.uuid, userUuid);
      await machines.deleteMachine(machine.uuid);
      await expect(
        usages.createUsingMachine(machine.uuid, otherUserUuid),
      ).rejects.toThrow('Machine not found.');
      await expect(
        usages.confirmCompletedAndRegister(
          otherUserUuid,
          machine.uuid,
          active.uuid,
        ),
      ).rejects.toThrow('Machine not found.');
      expect(
        await usages.enableMachineNotification(otherUserUuid, machine.uuid),
      ).toBe(0);
      expect(
        await usages.disableMachineNotification(userUuid, machine.uuid),
      ).toBe(0);
      expect(
        await usages.unlinkUserFromUsingMachine(userUuid, machine.uuid),
      ).toBe(0);
      expect(await usages.finishUsingMachine(machine.uuid)).toBeNull();
      await expect(machines.updateMachine(machine.uuid, false)).rejects.toThrow(
        'Machine not found.',
      );
      await expect(
        machines.recordMachinePower(machine.uuid, 20),
      ).rejects.toThrow('Machine not found.');
      await expect(
        machines.recordMachinePowerByMacAddress(machine.macAddress!, 20),
      ).rejects.toThrow('Machine not found.');
      await expect(
        machines.updateMachineCommissioned(machine.uuid, 'replacement-mac'),
      ).rejects.toMatchObject({ code: 'P2025' });
      await expect(
        machines.resetMachineCommissioned(machine.uuid),
      ).rejects.toMatchObject({ code: 'P2025' });
      await expect(
        machines.updateMachineShortUrl(
          machine.uuid,
          'https://test.example/new',
          'new',
        ),
      ).rejects.toMatchObject({ code: 'P2025' });
      await machines.updateMachineStatusByMacAddress(
        machine.macAddress!,
        MachineStatus.DRY,
      );
      expect(
        await prisma.machine.findUnique({ where: { uuid: machine.uuid } }),
      ).toMatchObject({ status: machine.status });
      expect(
        await prisma.usingMachine.findUnique({ where: { uuid: active.uuid } }),
      ).toEqual(active);
    });

    it('reuses deleted slots and MACs while rejecting active duplicates and old QR codes', async () => {
      await expect(
        machines.createMachine({ ...room, index: 1 }),
      ).rejects.toThrow('Machine already exists.');
      await machines.deleteMachine(machine.uuid);
      const replacement = await machines.createMachine({ ...room, index: 1 });
      await machines.updateMachineCommissioned(
        replacement.uuid,
        machine.macAddress!,
      );
      expect(
        await machines.getMachineTypeByMacAddress(machine.macAddress!),
      ).toBe(room.type);
      await machines.recordMachinePowerByMacAddress(machine.macAddress!, 30);
      expect(await machines.getMachinePowerFrom(replacement.uuid)).toHaveLength(
        1,
      );
      expect(
        await prisma.machinePower.count({
          where: { machineUuid: machine.uuid },
        }),
      ).toBe(0);
      await expect(
        machines.updateMachineShortUrl(
          replacement.uuid,
          machine.shortUrl!,
          machine.shortCode!,
        ),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(
        await machines.getMachineWithUsageByShortCode(machine.shortCode!),
      ).toBeNull();
      const other = await machines.createMachine({ ...room, index: 2 });
      await expect(
        machines.updateMachineCommissioned(other.uuid, machine.macAddress!),
      ).rejects.toMatchObject({ code: 'P2002' });
      await machines.deleteMachine(replacement.uuid);
      await machines.deleteMachine(other.uuid);
      const batch = await machines.createMultipleMachines({
        ...room,
        startIndex: 1,
        endIndex: 2,
      });
      expect(batch.map((item) => item.index)).toEqual([1, 2]);
      await expect(
        machines.createMultipleMachines({
          ...room,
          startIndex: 1,
          endIndex: 3,
        }),
      ).rejects.toThrow('Machine already exists.');
      expect(
        await prisma.machine.count({ where: { ...room, deletedAt: null } }),
      ).toBe(2);
      for (const item of batch) await machines.deleteMachine(item.uuid);
    });

    it('serializes deletion with session creation without losing records', async () => {
      const results = await Promise.allSettled([
        usages.createUsingMachine(machine.uuid, userUuid),
        machines.deleteMachine(machine.uuid),
      ]);
      expect(results[1].status).toBe('fulfilled');
      expect(await machines.getMachine(machine.uuid)).toBeNull();
      const sessions = await prisma.usingMachine.findMany({
        where: { machineUuid: machine.uuid },
      });
      expect(sessions).toHaveLength(results[0].status === 'fulfilled' ? 1 : 0);
      if (results[0].status === 'rejected') {
        expect(results[0].reason).toMatchObject({ status: 404 });
      }
      await expect(usages.createUsingMachine(machine.uuid)).rejects.toThrow(
        'Machine not found.',
      );
      expect(await usages.getUsingMachinesByUser(userUuid)).not.toContainEqual(
        expect.objectContaining({ machineUuid: machine.uuid }),
      );
    });
  });
});
