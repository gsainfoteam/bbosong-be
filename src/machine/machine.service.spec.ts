import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  Gender,
  Location,
  MachineStatus,
  MachineType,
} from '../../generated/prisma/enums';
import type { MachineWithUsage } from '@lib/database/types/machine.type';
import { MachineService } from './machine.service';

jest.mock(
  '@gsainfoteam/nest-observability',
  () => ({
    Trace: () => (target: unknown) => target,
  }),
  { virtual: true },
);
jest.mock(
  '@lib/logger',
  () => ({
    Loggable: () => (target: unknown) => target,
  }),
  { virtual: true },
);
jest.mock('@lib/database/repositories/machine.repository', () => ({}), {
  virtual: true,
});
jest.mock('@lib/database/repositories/using-machine.repository', () => ({}), {
  virtual: true,
});
jest.mock('@lib/matter-client/matter-connection.service', () => ({}), {
  virtual: true,
});
jest.mock(
  'generated/prisma/client',
  () =>
    jest.requireActual<typeof import('../../generated/prisma/enums')>(
      '../../generated/prisma/enums',
    ),
  { virtual: true },
);
jest.mock(
  'src/common/utils/format-error.util',
  () => ({ formatError: String }),
  { virtual: true },
);
jest.mock('../notification/notification.service', () => ({}));
jest.mock('../notification/services/live-activity.service', () => ({}));
jest.mock('../notification/services/live-update.service', () => ({}));
jest.mock('./shlink.service', () => ({}));

describe('MachineService access and registration', () => {
  const machineUuid = '00000000-0000-4000-8000-000000000001';
  const userUuid = '00000000-0000-4000-8000-000000000002';
  const machine = {
    uuid: machineUuid,
    gender: Gender.MALE,
    location: Location.A,
    type: MachineType.WASHER,
    status: MachineStatus.WASH,
    currentUsage: null,
  } as MachineWithUsage;
  const machineRepository = {
    getMachine: jest.fn(),
    getMachineWithUsage: jest.fn(),
    getMachineWithUsageByShortCode: jest.fn(),
    getMachines: jest.fn(),
    getMachinesWithUsage: jest.fn(),
    getMachineTypeByMacAddress: jest.fn(),
    updateMachine: jest.fn(),
    updateThinqDryerState: jest.fn(),
    recordMachinePowerByMacAddress: jest.fn(),
    updateMachineStatusByMacAddress: jest.fn(),
  };
  const usingMachineRepository = {
    confirmCompletedAndRegister: jest.fn(),
    finishUsingMachine: jest.fn(),
    unlinkUserFromUsingMachine: jest.fn(),
    enableMachineNotification: jest.fn(),
    getUsingMachineByMachineUuid: jest.fn(),
    getLatestEndedUsingMachineByUser: jest.fn(),
    createUsingMachine: jest.fn(),
    countDailySessionsByRegistration: jest.fn(),
    countUsageStats: jest.fn(),
    setEstimatedEndsAt: jest.fn(),
  };
  let service: MachineService;
  const liveActivityService = {
    completeForUsingMachine: jest.fn(),
    endForUsingMachine: jest.fn(),
    endForUserOnMachine: jest.fn(),
    syncRunning: jest.fn(),
    registerCompletedToken: jest.fn(),
    registerToken: jest.fn(),
    unregisterToken: jest.fn(),
  };
  const liveUpdateService = {
    syncRunning: jest.fn(),
    end: jest.fn(),
  };
  const notificationService = {
    notifyMachineReregistered: jest.fn(),
    notifyMachineCompletion: jest.fn(),
    notifyMachineError: jest.fn(),
    notifyLaundryRoomAvailable: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new MachineService(
      machineRepository as never,
      usingMachineRepository as never,
      notificationService as never,
      {} as never,
      {} as never,
      { get: jest.fn() } as never,
      liveActivityService as never,
      liveUpdateService as never,
    );
    machineRepository.getMachineWithUsage.mockResolvedValue(machine);
    machineRepository.getMachineWithUsageByShortCode.mockResolvedValue(machine);
    usingMachineRepository.enableMachineNotification.mockResolvedValue(1);
    usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue(null);
    machineRepository.getMachine.mockResolvedValue(machine);
    notificationService.notifyMachineCompletion.mockResolvedValue(undefined);
    notificationService.notifyMachineError.mockResolvedValue(undefined);
    notificationService.notifyLaundryRoomAvailable.mockResolvedValue(undefined);
  });

  describe('getMachines', () => {
    it('returns machines with currentUsage for the list API', async () => {
      const startedAt = new Date('2026-11-01T00:00:00.000Z');
      const withUsage = {
        ...machine,
        status: MachineStatus.DRY,
        currentUsage: {
          uuid: 'usage',
          machineUuid,
          userUuid,
          notifyOnCompletion: true,
          startedAt,
          endedAt: null,
        },
      };
      const idle = {
        ...machine,
        uuid: '00000000-0000-4000-8000-000000000099',
        status: MachineStatus.IDLE,
        currentUsage: null,
      };
      machineRepository.getMachinesWithUsage.mockResolvedValue([
        withUsage,
        idle,
      ]);

      await expect(service.getMachines()).resolves.toEqual([withUsage, idle]);
      expect(machineRepository.getMachinesWithUsage).toHaveBeenCalled();
      expect(machineRepository.getMachines).not.toHaveBeenCalled();
    });
  });

  describe.each([
    [
      'UUID',
      (service: MachineService, gender: Gender) =>
        service.getMachineDetail(machineUuid, gender),
    ],
    [
      'short code',
      (service: MachineService, gender: Gender) =>
        service.getMachineDetailByShortCode('qr123', gender),
    ],
  ] as const)('%s detail lookup', (_name, lookup) => {
    it.each([Gender.MALE, Gender.FEMALE])(
      'allows matching gender: %s',
      async (gender) => {
        machineRepository.getMachineWithUsage.mockResolvedValue({
          ...machine,
          gender,
        });
        machineRepository.getMachineWithUsageByShortCode.mockResolvedValue({
          ...machine,
          gender,
        });
        await expect(lookup(service, gender)).resolves.toEqual({
          ...machine,
          gender,
        });
      },
    );

    it.each([Gender.MALE, Gender.FEMALE])(
      'rejects mismatched gender: %s',
      async (gender) => {
        const machineGender =
          gender === Gender.MALE ? Gender.FEMALE : Gender.MALE;
        machineRepository.getMachineWithUsage.mockResolvedValue({
          ...machine,
          gender: machineGender,
        });
        machineRepository.getMachineWithUsageByShortCode.mockResolvedValue({
          ...machine,
          gender: machineGender,
        });
        await expect(lookup(service, gender)).rejects.toThrow(
          ForbiddenException,
        );
      },
    );

    it('preserves not-found errors', async () => {
      machineRepository.getMachineWithUsage.mockResolvedValue(null);
      machineRepository.getMachineWithUsageByShortCode.mockResolvedValue(null);
      await expect(lookup(service, Gender.MALE)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it('blocks direct registration before changing usage', async () => {
    await expect(
      service.enableMachineNotification(userUuid, machineUuid, Gender.FEMALE),
    ).rejects.toThrow(ForbiddenException);
    expect(
      usingMachineRepository.enableMachineNotification,
    ).not.toHaveBeenCalled();
  });

  it('registers a machine with matching gender', async () => {
    await expect(
      service.enableMachineNotification(userUuid, machineUuid, Gender.MALE),
    ).resolves.toBeUndefined();
    expect(
      usingMachineRepository.enableMachineNotification,
    ).toHaveBeenCalledWith(userUuid, machineUuid);
    // Only the washer Live Update lookup; no failure diagnosis.
    expect(
      usingMachineRepository.getUsingMachineByMachineUuid,
    ).toHaveBeenCalledTimes(1);
  });

  it('returns a distinct error when the machine is not running', async () => {
    usingMachineRepository.enableMachineNotification.mockResolvedValue(0);
    await expect(
      service.enableMachineNotification(userUuid, machineUuid, Gender.MALE),
    ).rejects.toMatchObject({
      status: 404,
      response: {
        statusCode: 404,
        message: 'Machine is not running.',
        errorCode: 'MACHINE_NOT_RUNNING',
      },
    });
    expect(
      usingMachineRepository.getUsingMachineByMachineUuid,
    ).toHaveBeenCalledWith(machineUuid);
  });

  it('returns a conflict when another user has claimed the machine', async () => {
    // The claim may happen after the initial detail lookup.
    usingMachineRepository.enableMachineNotification.mockResolvedValue(0);
    usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue({
      machineUuid,
      userUuid: '00000000-0000-4000-8000-000000000003',
      startedAt: new Date(),
    });

    await expect(
      service.enableMachineNotification(userUuid, machineUuid, Gender.MALE),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        statusCode: 409,
        message: 'Machine is already registered to another user.',
        errorCode: 'MACHINE_ALREADY_REGISTERED',
      },
    });
  });

  it.each([30 * 60 * 1000 - 1, 30 * 60 * 1000, 31 * 60 * 1000])(
    'classifies registration after %i milliseconds',
    async (elapsed) => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      usingMachineRepository.enableMachineNotification.mockResolvedValue(0);
      usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue({
        uuid: 'previous-usage',
        userUuid: 'other-user',
        startedAt: new Date(now - elapsed),
      });
      try {
        await expect(
          service.enableMachineNotification(userUuid, machineUuid, Gender.MALE),
        ).rejects.toMatchObject({
          response: {
            errorCode:
              elapsed >= 30 * 60 * 1000
                ? 'MACHINE_COMPLETION_CONFIRMATION_REQUIRED'
                : 'MACHINE_ALREADY_REGISTERED',
            ...(elapsed >= 30 * 60 * 1000
              ? { usageUuid: 'previous-usage' }
              : {}),
          },
        });
      } finally {
        jest.restoreAllMocks();
      }
    },
  );

  it('notifies previous owner after successful replacement even if notifications were disabled', async () => {
    usingMachineRepository.confirmCompletedAndRegister.mockResolvedValue({
      userUuid: 'other-user',
      notifyOnCompletion: false,
    });
    await service.confirmCompletedAndRegister(
      userUuid,
      machineUuid,
      Gender.MALE,
      'previous-usage',
    );
    expect(
      usingMachineRepository.confirmCompletedAndRegister,
    ).toHaveBeenCalledWith(userUuid, machineUuid, 'previous-usage');
    expect(notificationService.notifyMachineReregistered).toHaveBeenCalledWith(
      'other-user',
      machine,
    );
    expect(
      notificationService.notifyLaundryRoomAvailable,
    ).not.toHaveBeenCalled();
  });

  it('keeps successful replacement when push fails', async () => {
    usingMachineRepository.confirmCompletedAndRegister.mockResolvedValue({
      userUuid: 'other-user',
    });
    notificationService.notifyMachineReregistered.mockRejectedValue(
      new Error('push unavailable'),
    );
    await expect(
      service.confirmCompletedAndRegister(
        userUuid,
        machineUuid,
        Gender.MALE,
        'previous-usage',
      ),
    ).resolves.toBeUndefined();
  });

  it('does not notify when the transaction fails', async () => {
    usingMachineRepository.confirmCompletedAndRegister.mockRejectedValue(
      new Error('conflict'),
    );
    await expect(
      service.confirmCompletedAndRegister(
        userUuid,
        machineUuid,
        Gender.MALE,
        'previous-usage',
      ),
    ).rejects.toThrow('conflict');
    expect(
      notificationService.notifyMachineReregistered,
    ).not.toHaveBeenCalled();
  });

  it('blocks confirmation for mismatched gender and missing machines', async () => {
    await expect(
      service.confirmCompletedAndRegister(
        userUuid,
        machineUuid,
        Gender.FEMALE,
        'previous-usage',
      ),
    ).rejects.toThrow(ForbiddenException);
    machineRepository.getMachineWithUsage.mockResolvedValue(null);
    await expect(
      service.confirmCompletedAndRegister(
        userUuid,
        machineUuid,
        Gender.MALE,
        'previous-usage',
      ),
    ).rejects.toThrow(NotFoundException);
    expect(
      usingMachineRepository.confirmCompletedAndRegister,
    ).not.toHaveBeenCalled();
  });

  it('preserves missing-machine errors before attempting registration', async () => {
    machineRepository.getMachineWithUsage.mockResolvedValue(null);

    await expect(
      service.enableMachineNotification(userUuid, machineUuid, Gender.MALE),
    ).rejects.toThrow('Machine not found.');
    expect(
      usingMachineRepository.enableMachineNotification,
    ).not.toHaveBeenCalled();
  });

  it('does not classify database failures as registration errors', async () => {
    const error = new Error('Database unavailable');
    usingMachineRepository.enableMachineNotification.mockRejectedValue(error);

    await expect(
      service.enableMachineNotification(userUuid, machineUuid, Gender.MALE),
    ).rejects.toBe(error);
    expect(
      usingMachineRepository.getUsingMachineByMachineUuid,
    ).not.toHaveBeenCalled();
  });

  it('completes the Live Activity of the closed session even without completion notification', async () => {
    usingMachineRepository.finishUsingMachine.mockResolvedValue({
      uuid: 'usage-1',
      machineUuid,
      userUuid,
      notifyOnCompletion: false,
      endedAt: new Date(),
    });
    await service.finishUsingMachine(machineUuid);
    expect(liveActivityService.completeForUsingMachine).toHaveBeenCalledWith(
      'usage-1',
      userUuid,
    );
    expect(liveActivityService.endForUsingMachine).not.toHaveBeenCalled();
    expect(notificationService.notifyMachineCompletion).not.toHaveBeenCalled();
  });

  it('keeps notifying when completing the Live Activity fails', async () => {
    usingMachineRepository.finishUsingMachine.mockResolvedValue({
      uuid: 'usage-1',
      machineUuid,
      userUuid,
      notifyOnCompletion: true,
      endedAt: new Date(),
    });
    liveActivityService.completeForUsingMachine.mockRejectedValue(
      new Error('boom'),
    );
    await service.finishUsingMachine(machineUuid);
    expect(notificationService.notifyMachineCompletion).toHaveBeenCalledTimes(
      1,
    );
    expect(
      notificationService.notifyLaundryRoomAvailable,
    ).toHaveBeenCalledTimes(1);
  });

  it('does not end Live Activities when the session had already ended', async () => {
    usingMachineRepository.finishUsingMachine.mockResolvedValue(null);
    await service.finishUsingMachine(machineUuid);
    expect(liveActivityService.completeForUsingMachine).not.toHaveBeenCalled();
  });

  it("shows done, without ending, on the previous user's Live Activity when another user confirms completion", async () => {
    usingMachineRepository.confirmCompletedAndRegister.mockResolvedValue({
      uuid: 'previous-usage',
      userUuid: null,
    });
    machineRepository.getMachineWithUsage.mockResolvedValue(machine);
    await service.confirmCompletedAndRegister(
      userUuid,
      machineUuid,
      Gender.MALE,
      'previous-usage',
    );
    expect(liveActivityService.completeForUsingMachine).toHaveBeenCalledWith(
      'previous-usage',
      null,
    );
    expect(liveActivityService.endForUsingMachine).not.toHaveBeenCalled();
  });

  it('sends the Live Update end message when the session finishes', async () => {
    const startedAt = new Date('2026-11-21T00:00:00Z');
    usingMachineRepository.finishUsingMachine.mockResolvedValue({
      uuid: 'usage-1',
      machineUuid,
      userUuid,
      notifyOnCompletion: false,
      startedAt,
      endedAt: new Date(),
    });
    machineRepository.getMachine.mockResolvedValue(machine);
    await service.finishUsingMachine(machineUuid);
    expect(liveUpdateService.end).toHaveBeenCalledWith(
      'usage-1',
      userUuid,
      expect.objectContaining({ machineUuid: machine.uuid, startedAt }),
    );
  });

  it('sends the Live Update end message when the user unlinks from the machine', async () => {
    usingMachineRepository.unlinkUserFromUsingMachine.mockResolvedValue(1);
    machineRepository.getMachine.mockResolvedValue(machine);
    await service.unlinkUserFromMachine(userUuid, machineUuid);
    expect(liveUpdateService.end).toHaveBeenCalledWith(
      null,
      userUuid,
      expect.objectContaining({ machineUuid: machine.uuid, startedAt: null }),
    );
  });

  it("ends the user's Live Activities when they unlink from the machine", async () => {
    usingMachineRepository.unlinkUserFromUsingMachine.mockResolvedValue(1);
    await service.unlinkUserFromMachine(userUuid, machineUuid);
    expect(liveActivityService.endForUserOnMachine).toHaveBeenCalledWith(
      userUuid,
      machineUuid,
    );
  });

  it("still ends a finished session's Live Activity when unlinking finds no running session", async () => {
    usingMachineRepository.unlinkUserFromUsingMachine.mockResolvedValue(0);
    await expect(
      service.unlinkUserFromMachine(userUuid, machineUuid),
    ).rejects.toThrow(NotFoundException);
    expect(liveActivityService.endForUserOnMachine).toHaveBeenCalledWith(
      userUuid,
      machineUuid,
    );
  });

  describe('setRemainingTime', () => {
    const now = new Date('2026-11-25T10:00:00.000Z');
    const usage = {
      uuid: 'usage-1',
      machineUuid,
      userUuid,
      notifyOnCompletion: true,
      startedAt: new Date('2026-11-25T09:50:00.000Z'),
      endedAt: null,
      estimatedEndsAt: null,
    };

    it('stores server now + remaining minutes and syncs the Live Activity', async () => {
      const estimatedEndsAt = new Date('2026-11-25T10:37:00.000Z');
      usingMachineRepository.setEstimatedEndsAt.mockResolvedValue({
        ...usage,
        estimatedEndsAt,
      });

      await expect(
        service.setRemainingTime(userUuid, machineUuid, Gender.MALE, 37, now),
      ).resolves.toEqual(estimatedEndsAt);
      expect(usingMachineRepository.setEstimatedEndsAt).toHaveBeenCalledWith(
        userUuid,
        machineUuid,
        estimatedEndsAt,
      );
      expect(liveActivityService.syncRunning).toHaveBeenCalledWith(
        'usage-1',
        userUuid,
        { state: null, remainingMinutes: 37 },
        now,
        { force: true },
      );
    });

    it('rejects dryers', async () => {
      machineRepository.getMachineWithUsage.mockResolvedValue({
        ...machine,
        type: MachineType.DRYER,
      });

      await expect(
        service.setRemainingTime(userUuid, machineUuid, Gender.MALE, 37, now),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(usingMachineRepository.setEstimatedEndsAt).not.toHaveBeenCalled();
    });

    it('rejects a machine of another gender', async () => {
      await expect(
        service.setRemainingTime(userUuid, machineUuid, Gender.FEMALE, 37, now),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns MACHINE_NOT_RUNNING without an open session', async () => {
      usingMachineRepository.setEstimatedEndsAt.mockResolvedValue(null);

      await expect(
        service.setRemainingTime(userUuid, machineUuid, Gender.MALE, 37, now),
      ).rejects.toMatchObject({
        response: { errorCode: 'MACHINE_NOT_RUNNING' },
      });
      expect(liveActivityService.syncRunning).not.toHaveBeenCalled();
    });

    it('forbids a session operated by another user', async () => {
      usingMachineRepository.setEstimatedEndsAt.mockResolvedValue(null);
      usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue({
        ...usage,
        userUuid: 'someone-else',
      });

      await expect(
        service.setRemainingTime(userUuid, machineUuid, Gender.MALE, 37, now),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('still succeeds when the Live Activity push fails', async () => {
      usingMachineRepository.setEstimatedEndsAt.mockResolvedValue(usage);
      liveActivityService.syncRunning.mockRejectedValue(new Error('apns'));

      await expect(
        service.setRemainingTime(userUuid, machineUuid, Gender.MALE, 37, now),
      ).resolves.toEqual(new Date('2026-11-25T10:37:00.000Z'));
    });
  });

  describe('washer Live Update', () => {
    const usage = {
      uuid: 'usage-1',
      machineUuid,
      userUuid,
      notifyOnCompletion: true,
      startedAt: new Date('2026-11-25T09:50:00.000Z'),
      endedAt: null,
      estimatedEndsAt: null,
    };

    it('starts when a user registers a washer', async () => {
      usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue(
        usage,
      );

      await service.enableMachineNotification(
        userUuid,
        machineUuid,
        Gender.MALE,
      );

      expect(liveUpdateService.syncRunning).toHaveBeenCalledWith(
        'usage-1',
        userUuid,
        expect.objectContaining({ kind: MachineType.WASHER }),
        { state: 'RUNNING', remainingMinutes: null },
        expect.any(Date),
        { force: false },
      );
    });

    it('is not started for dryers (ThinQ sync owns them)', async () => {
      machineRepository.getMachine.mockResolvedValue({
        ...machine,
        type: MachineType.DRYER,
      });
      usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue(
        usage,
      );

      await service.enableMachineNotification(
        userUuid,
        machineUuid,
        Gender.MALE,
      );

      expect(liveUpdateService.syncRunning).not.toHaveBeenCalled();
    });

    it('carries the entered remaining time', async () => {
      const now = new Date('2026-11-25T10:00:00.000Z');
      usingMachineRepository.setEstimatedEndsAt.mockResolvedValue(usage);
      usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue({
        ...usage,
        estimatedEndsAt: new Date('2026-11-25T10:37:00.000Z'),
      });

      await service.setRemainingTime(
        userUuid,
        machineUuid,
        Gender.MALE,
        37,
        now,
      );

      expect(liveUpdateService.syncRunning).toHaveBeenCalledWith(
        'usage-1',
        userUuid,
        expect.objectContaining({ kind: MachineType.WASHER }),
        { state: 'RUNNING', remainingMinutes: 37 },
        now,
        { force: true },
      );
    });

    it('keeps 0 minutes left (not "not entered") when re-registering after the entered time passed', async () => {
      usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue({
        ...usage,
        estimatedEndsAt: new Date(Date.now() - 5 * 60_000),
      });

      await service.enableMachineNotification(
        userUuid,
        machineUuid,
        Gender.MALE,
      );

      expect(liveUpdateService.syncRunning).toHaveBeenCalledWith(
        'usage-1',
        userUuid,
        expect.anything(),
        { state: 'RUNNING', remainingMinutes: 0 },
        expect.any(Date),
        { force: false },
      );
    });

    it('does not fail registration when the push fails', async () => {
      usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue(
        usage,
      );
      liveUpdateService.syncRunning.mockRejectedValue(new Error('fcm'));

      await expect(
        service.enableMachineNotification(userUuid, machineUuid, Gender.MALE),
      ).resolves.toBeUndefined();
    });
  });

  describe('Live Activity registration', () => {
    const dto = { pushToken: 'ab12', environment: 'PRODUCTION' } as never;
    const running = { uuid: 'usage-1', machineUuid, userUuid };

    it("stores the token for the user's running session", async () => {
      usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue(
        running,
      );
      await service.registerLiveActivity(userUuid, machineUuid, dto);
      expect(liveActivityService.registerToken).toHaveBeenCalledWith({
        userUuid,
        usingMachineUuid: 'usage-1',
        pushToken: 'ab12',
        environment: 'PRODUCTION',
      });
      expect(liveActivityService.endForUsingMachine).not.toHaveBeenCalled();
    });

    it('rejects a session that belongs to another user', async () => {
      usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue({
        ...running,
        userUuid: 'someone-else',
      });
      await expect(
        service.registerLiveActivity(userUuid, machineUuid, dto),
      ).rejects.toThrow(ForbiddenException);
      expect(liveActivityService.registerToken).not.toHaveBeenCalled();
    });

    it('completes the activity when the session finished while registering', async () => {
      usingMachineRepository.getUsingMachineByMachineUuid
        .mockResolvedValueOnce(running)
        .mockResolvedValueOnce(null);
      await service.registerLiveActivity(userUuid, machineUuid, dto);
      expect(liveActivityService.completeForUsingMachine).toHaveBeenCalledWith(
        'usage-1',
        userUuid,
      );
    });

    it('ends the activity when the user unlinked while registering', async () => {
      usingMachineRepository.getUsingMachineByMachineUuid
        .mockResolvedValueOnce(running)
        .mockResolvedValueOnce({ ...running, userUuid: null });
      await service.registerLiveActivity(userUuid, machineUuid, dto);
      expect(liveActivityService.endForUserOnMachine).toHaveBeenCalledWith(
        userUuid,
        machineUuid,
      );
      expect(
        liveActivityService.completeForUsingMachine,
      ).not.toHaveBeenCalled();
    });

    it('stores the token and shows done when the session just ended', async () => {
      usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue(
        null,
      );
      usingMachineRepository.getLatestEndedUsingMachineByUser.mockResolvedValue(
        { ...running, endedAt: new Date(Date.now() - 60_000) },
      );
      await service.registerLiveActivity(userUuid, machineUuid, dto);
      expect(liveActivityService.registerCompletedToken).toHaveBeenCalledWith({
        userUuid,
        usingMachineUuid: 'usage-1',
        pushToken: 'ab12',
        environment: 'PRODUCTION',
      });
      expect(liveActivityService.registerToken).not.toHaveBeenCalled();
    });

    it.each([
      ['no session', null],
      [
        'a session that ended long ago',
        { ...running, endedAt: new Date(Date.now() - 9 * 60 * 60_000) },
      ],
    ])('responds 404 for %s', async (_name, ended) => {
      usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue(
        null,
      );
      usingMachineRepository.getLatestEndedUsingMachineByUser.mockResolvedValue(
        ended,
      );
      await expect(
        service.registerLiveActivity(userUuid, machineUuid, dto),
      ).rejects.toThrow(NotFoundException);
      expect(liveActivityService.registerCompletedToken).not.toHaveBeenCalled();
    });
  });

  it('uses the closed session to notify its user after completion', async () => {
    usingMachineRepository.finishUsingMachine.mockResolvedValue({
      machineUuid,
      userUuid,
      notifyOnCompletion: true,
      endedAt: new Date(),
    });
    await service.finishUsingMachine(machineUuid);
    expect(notificationService.notifyMachineCompletion).toHaveBeenCalledWith(
      userUuid,
      machine,
    );
    expect(notificationService.notifyLaundryRoomAvailable).toHaveBeenCalledWith(
      machine.location,
      machine.gender,
      machine.type,
    );
    expect(
      usingMachineRepository.getUsingMachineByMachineUuid,
    ).not.toHaveBeenCalled();
  });

  it('does not send notifications again when the session has already ended', async () => {
    usingMachineRepository.finishUsingMachine.mockResolvedValue(null);
    await service.finishUsingMachine(machineUuid);
    expect(notificationService.notifyMachineCompletion).not.toHaveBeenCalled();
    expect(
      notificationService.notifyLaundryRoomAvailable,
    ).not.toHaveBeenCalled();
  });

  it('retains completion behavior when the user disabled notification', async () => {
    usingMachineRepository.finishUsingMachine.mockResolvedValue({
      machineUuid,
      userUuid,
      notifyOnCompletion: false,
      endedAt: new Date(),
    });
    await service.finishUsingMachine(machineUuid);
    expect(notificationService.notifyMachineCompletion).not.toHaveBeenCalled();
    expect(
      notificationService.notifyLaundryRoomAvailable,
    ).toHaveBeenCalledTimes(1);
  });

  it.each([
    [false, true, 1],
    [true, true, 0],
    [true, false, 0],
  ])(
    'notifies laundry room subscribers only when isAvailable goes %s -> %s',
    async (before, after, calls) => {
      machineRepository.getMachine.mockResolvedValue({
        ...machine,
        isAvailable: before,
      });
      machineRepository.updateMachine.mockResolvedValue({
        ...machine,
        isAvailable: after,
      });
      await service.updateMachine(machineUuid, { isAvailable: after });
      expect(
        notificationService.notifyLaundryRoomAvailable,
      ).toHaveBeenCalledTimes(calls);
    },
  );

  describe('ThinQ dryer lifecycle', () => {
    beforeEach(() => {
      machineRepository.updateThinqDryerState.mockResolvedValue(1);
      machineRepository.getMachine.mockResolvedValue({
        ...machine,
        type: MachineType.DRYER,
        thinqDeviceId: 'device',
        macAddress: null,
      });
    });

    it.each([null, false, true])(
      'initializes and tracks a deviceId-only dryer without a MAC (isCommissioned=%s)',
      async (isCommissioned) => {
        const dryer = {
          ...machine,
          type: MachineType.DRYER,
          status: MachineStatus.IDLE,
          thinqDeviceId: 'device',
          macAddress: null,
          matterPayload: null,
          isCommissioned,
        };
        machineRepository.getMachines.mockResolvedValue([dryer]);
        service = new MachineService(
          machineRepository as never,
          usingMachineRepository as never,
          notificationService as never,
          { addPowerListener: jest.fn() } as never,
          {} as never,
          {} as never,
          liveActivityService as never,
          liveUpdateService as never,
        );
        await expect(service.onModuleInit()).resolves.toBeUndefined();
        await service.updateThinqDryerState(machineUuid, 'device', {
          runState: { currentState: 'RUNNING' },
          timer: { remainHour: 0, remainMinute: 20 },
        });
        await service.updateThinqDryerState(machineUuid, 'device', {
          runState: { currentState: 'END' },
        });
        expect(usingMachineRepository.createUsingMachine).toHaveBeenCalledWith(
          machineUuid,
          undefined,
          true,
        );
        expect(usingMachineRepository.finishUsingMachine).toHaveBeenCalledWith(
          machineUuid,
        );
        expect(
          machineRepository.recordMachinePowerByMacAddress,
        ).not.toHaveBeenCalled();
        expect(
          machineRepository.updateMachineStatusByMacAddress,
        ).not.toHaveBeenCalled();
        await service.onModuleDestroy();
      },
    );

    it('keeps the MAC requirement for commissioned Matter washers', async () => {
      machineRepository.getMachines.mockResolvedValue([
        { ...machine, macAddress: null, isCommissioned: true },
      ]);
      await expect(service.onModuleInit()).rejects.toThrow(
        'mac address is not set',
      );
    });

    it('rejects Matter commissioning for a ThinQ dryer', async () => {
      machineRepository.getMachine.mockResolvedValue({
        ...machine,
        type: MachineType.DRYER,
        thinqDeviceId: 'device',
        macAddress: null,
        matterPayload: null,
        isCommissioned: null,
      });
      await expect(service.commissionMachine(machineUuid)).rejects.toThrow(
        'ThinQ dryers do not require Matter commissioning.',
      );
    });

    it.each(['RUNNING', 'COOLING', 'PAUSE'])(
      'treats %s as occupied and records remaining time',
      async (currentState) => {
        await service.updateThinqDryerState(machineUuid, 'device', {
          runState: { currentState },
          timer: { remainHour: 1, remainMinute: 20 },
        });
        expect(machineRepository.updateThinqDryerState).toHaveBeenCalledWith(
          machineUuid,
          'device',
          currentState,
          80,
          MachineStatus.DRY,
        );
        expect(usingMachineRepository.createUsingMachine).toHaveBeenCalledWith(
          machineUuid,
          undefined,
          true,
        );
        expect(
          usingMachineRepository.finishUsingMachine,
        ).not.toHaveBeenCalled();
      },
    );

    it('syncs the running Live Activity with the ThinQ state and remaining time', async () => {
      usingMachineRepository.createUsingMachine.mockResolvedValue({
        uuid: 'usage-9',
        userUuid,
      });
      await service.updateThinqDryerState(machineUuid, 'device', {
        runState: { currentState: 'COOLING' },
        timer: { remainHour: 0, remainMinute: 15 },
      });
      expect(liveActivityService.syncRunning).toHaveBeenCalledWith(
        'usage-9',
        userUuid,
        { state: 'COOLING', remainingMinutes: 15 },
      );
    });

    it('treats DETECTING as occupied without remaining time', async () => {
      await service.updateThinqDryerState(machineUuid, 'device', {
        runState: { currentState: 'DETECTING' },
        timer: { remainHour: 0, remainMinute: 0 },
      });
      expect(machineRepository.updateThinqDryerState).toHaveBeenCalledWith(
        machineUuid,
        'device',
        'DETECTING',
        null,
        MachineStatus.DRY,
      );
      expect(usingMachineRepository.createUsingMachine).toHaveBeenCalledWith(
        machineUuid,
        undefined,
        true,
      );
      expect(usingMachineRepository.finishUsingMachine).not.toHaveBeenCalled();
    });

    it.each(['END', 'POWER_OFF', 'SLEEP', 'INITIAL', 'WRINKLE_CARE'])(
      'closes the usage on %s',
      async (currentState) => {
        await service.updateThinqDryerState(machineUuid, 'device', {
          runState: { currentState },
        });
        expect(machineRepository.updateThinqDryerState).toHaveBeenCalledWith(
          machineUuid,
          'device',
          currentState,
          null,
          MachineStatus.IDLE,
        );
        expect(usingMachineRepository.finishUsingMachine).toHaveBeenCalledWith(
          machineUuid,
        );
        expect(
          usingMachineRepository.createUsingMachine,
        ).not.toHaveBeenCalled();
      },
    );

    it.each(['ERROR', 'RESERVED', 'UNKNOWN'])(
      'keeps the lifecycle unchanged for %s even with zero remaining time',
      async (currentState) => {
        await service.updateThinqDryerState(machineUuid, 'device', {
          runState: { currentState },
          timer: { remainHour: 0, remainMinute: 0 },
        });
        expect(machineRepository.updateThinqDryerState).toHaveBeenCalledWith(
          machineUuid,
          'device',
          currentState,
          0,
          null,
        );
        expect(
          usingMachineRepository.createUsingMachine,
        ).not.toHaveBeenCalled();
        expect(
          usingMachineRepository.finishUsingMachine,
        ).not.toHaveBeenCalled();
      },
    );

    it('notifies the active user once when ThinQ reports ERROR', async () => {
      const dryer = {
        ...machine,
        type: MachineType.DRYER,
        thinqDeviceId: 'device',
        thinqCurrentState: 'RUNNING',
        macAddress: null,
      };
      machineRepository.getMachine.mockResolvedValue(dryer);
      usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue({
        machineUuid,
        userUuid,
        notifyOnCompletion: false,
        endedAt: null,
      });

      await service.updateThinqDryerState(machineUuid, 'device', {
        runState: { currentState: 'ERROR' },
      });
      machineRepository.getMachine.mockResolvedValue({
        ...dryer,
        thinqCurrentState: 'ERROR',
      });
      await service.updateThinqDryerState(machineUuid, 'device', {
        runState: { currentState: 'ERROR' },
      });

      expect(notificationService.notifyMachineError).toHaveBeenCalledTimes(1);
      expect(notificationService.notifyMachineError).toHaveBeenCalledWith(
        userUuid,
        dryer,
      );
      expect(usingMachineRepository.finishUsingMachine).not.toHaveBeenCalled();
    });

    it('skips error alerts without an active registered user', async () => {
      machineRepository.getMachine.mockResolvedValue({
        ...machine,
        type: MachineType.DRYER,
        thinqDeviceId: 'device',
        thinqCurrentState: 'RUNNING',
        macAddress: null,
      });
      usingMachineRepository.getUsingMachineByMachineUuid.mockResolvedValue(
        null,
      );

      await service.updateThinqDryerState(machineUuid, 'device', {
        runState: { currentState: 'ERROR' },
      });

      expect(notificationService.notifyMachineError).not.toHaveBeenCalled();
    });

    it.each([
      {},
      { remainHour: 1 },
      { remainHour: -1, remainMinute: 20 },
      { remainHour: 0, remainMinute: 60 },
      { remainHour: 0.5, remainMinute: 0 },
      { remainHour: Infinity, remainMinute: 0 },
    ])(
      'does not invent remaining time for missing or invalid timers: %j',
      async (timer) => {
        await service.updateThinqDryerState(machineUuid, 'device', { timer });
        expect(machineRepository.updateThinqDryerState).toHaveBeenCalledWith(
          machineUuid,
          'device',
          null,
          null,
          null,
        );
      },
    );

    it('ignores an obsolete state response after deletion or remapping', async () => {
      machineRepository.updateThinqDryerState.mockResolvedValue(0);
      await service.updateThinqDryerState(machineUuid, 'device', {
        runState: { currentState: 'END' },
      });
      expect(usingMachineRepository.finishUsingMachine).not.toHaveBeenCalled();
    });

    it('retries a failed usage transition on the next poll', async () => {
      usingMachineRepository.createUsingMachine.mockRejectedValueOnce(
        new Error('database unavailable'),
      );
      const state = { runState: { currentState: 'RUNNING' } };
      await expect(
        service.updateThinqDryerState(machineUuid, 'device', state),
      ).rejects.toThrow('database unavailable');
      await service.updateThinqDryerState(machineUuid, 'device', state);
      expect(usingMachineRepository.createUsingMachine).toHaveBeenCalledTimes(
        2,
      );
    });
  });

  describe('Power status source selection', () => {
    const washer = {
      ...machine,
      macAddress: 'washer-mac',
      status: MachineStatus.IDLE,
    };
    let powerListener: (mac: string, power: number) => Promise<void>;
    beforeEach(async () => {
      jest.useFakeTimers();
      machineRepository.getMachines.mockResolvedValue([washer]);
      machineRepository.getMachineTypeByMacAddress = jest
        .fn()
        .mockResolvedValue(MachineType.WASHER);
      service = new MachineService(
        machineRepository as never,
        usingMachineRepository as never,
        notificationService as never,
        {
          addPowerListener: (listener: typeof powerListener) => {
            powerListener = listener;
          },
        } as never,
        {} as never,
        {} as never,
        liveActivityService as never,
        liveUpdateService as never,
      );
      await service.onModuleInit();
    });
    afterEach(async () => {
      await service.onModuleDestroy();
      jest.useRealTimers();
    });

    it('retains washer thresholds, unit conversion and the three-minute completion timer', async () => {
      await powerListener('washer-mac', 20_000);
      expect(
        machineRepository.recordMachinePowerByMacAddress,
      ).toHaveBeenCalledWith('washer-mac', 20);
      expect(
        machineRepository.updateMachineStatusByMacAddress,
      ).toHaveBeenCalledWith('washer-mac', MachineStatus.WASH);
      await powerListener('washer-mac', 1000);
      await jest.advanceTimersByTimeAsync(179_999);
      expect(usingMachineRepository.finishUsingMachine).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(
        machineRepository.updateMachineStatusByMacAddress,
      ).toHaveBeenLastCalledWith('washer-mac', MachineStatus.IDLE);
      expect(usingMachineRepository.finishUsingMachine).toHaveBeenCalledTimes(
        1,
      );
    });

    it('cancels the washer completion timer when power rises again', async () => {
      await powerListener('washer-mac', 20_000);
      await powerListener('washer-mac', 1000);
      await jest.advanceTimersByTimeAsync(120_000);
      await powerListener('washer-mac', 20_000);
      await jest.advanceTimersByTimeAsync(180_000);
      expect(usingMachineRepository.finishUsingMachine).not.toHaveBeenCalled();
    });

    it('forgets Matter power tracking when a dryer is mapped to ThinQ', async () => {
      const dryer = {
        ...machine,
        uuid: 'dryer',
        type: MachineType.DRYER,
        macAddress: 'dryer-mac',
        status: MachineStatus.DRY,
        thinqDeviceId: null,
      };
      machineRepository.getMachines.mockResolvedValue([dryer, washer]);
      await service.onModuleInit();
      machineRepository.getMachine.mockResolvedValue(dryer);
      machineRepository.updateMachine.mockResolvedValue({
        ...dryer,
        thinqDeviceId: 'device',
        macAddress: null,
        isCommissioned: false,
      });

      await powerListener('dryer-mac', 1000);
      await service.updateMachine('dryer', { thinqDeviceId: 'device' });
      machineRepository.recordMachinePowerByMacAddress.mockRejectedValue(
        new NotFoundException('Machine not found.'),
      );
      await powerListener('dryer-mac', 0);
      await jest.advanceTimersByTimeAsync(180_000);

      expect(usingMachineRepository.finishUsingMachine).not.toHaveBeenCalled();
      expect(
        machineRepository.updateMachineStatusByMacAddress,
      ).not.toHaveBeenCalledWith('dryer-mac', expect.anything());
    });

    it.each([null, 'other-device'])(
      'closes an active ThinQ session before mapping changes to %s',
      async (deviceId) => {
        const dryer = {
          ...machine,
          uuid: 'dryer',
          type: MachineType.DRYER,
          macAddress: null,
          status: MachineStatus.DRY,
          thinqDeviceId: 'device',
        };
        const callOrder: string[] = [];
        machineRepository.getMachine.mockResolvedValue(dryer);
        machineRepository.updateMachine.mockImplementation(() => {
          callOrder.push('update');
          return Promise.resolve({
            ...dryer,
            thinqDeviceId: deviceId,
            status: MachineStatus.IDLE,
          });
        });
        usingMachineRepository.finishUsingMachine.mockImplementation(() => {
          callOrder.push('finish');
          return Promise.resolve({
            uuid: 'usage',
            machineUuid: 'dryer',
            userUuid,
            notifyOnCompletion: true,
          });
        });

        await service.updateMachine('dryer', { thinqDeviceId: deviceId });

        expect(callOrder).toEqual(['finish', 'update']);
        expect(usingMachineRepository.finishUsingMachine).toHaveBeenCalledWith(
          'dryer',
        );
        expect(notificationService.notifyMachineCompletion).toHaveBeenCalled();
      },
    );

    it('does not start a ThinQ usage after the mapping disappears mid-poll', async () => {
      machineRepository.updateThinqDryerState.mockResolvedValue(1);
      machineRepository.getMachine.mockResolvedValue({
        ...machine,
        uuid: 'dryer',
        type: MachineType.DRYER,
        thinqDeviceId: null,
      });

      await service.updateThinqDryerState('dryer', 'device', {
        runState: { currentState: 'RUNNING' },
      });

      expect(usingMachineRepository.createUsingMachine).not.toHaveBeenCalled();
    });
  });

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
      ).toHaveBeenCalledWith('2026-11-10', '2026-11-10', {
        excludeUserUuids: [],
      });
    });

    it('forwards location, gender and type filters to the repository', async () => {
      usingMachineRepository.countDailySessionsByRegistration = jest
        .fn()
        .mockResolvedValue([]);

      await service.getDailySessionStats('2026-11-10', '2026-11-10', {
        location: Location.A,
        gender: Gender.MALE,
        type: MachineType.WASHER,
      });

      expect(
        usingMachineRepository.countDailySessionsByRegistration,
      ).toHaveBeenCalledWith('2026-11-10', '2026-11-10', {
        location: Location.A,
        gender: Gender.MALE,
        type: MachineType.WASHER,
        excludeUserUuids: [],
      });
    });
  });

  describe('getUsageStats', () => {
    it('delegates to UsingMachineRepository', async () => {
      const rows = [{ weekday: 1, hour: 9, sessionCount: 2 }];
      usingMachineRepository.countUsageStats = jest
        .fn()
        .mockResolvedValue(rows);

      await expect(
        service.getUsageStats('2026-11-01', '2026-11-10', ['weekday', 'hour'], {
          location: Location.A,
        }),
      ).resolves.toEqual(rows);
      expect(usingMachineRepository.countUsageStats).toHaveBeenCalledWith(
        '2026-11-01',
        '2026-11-10',
        ['weekday', 'hour'],
        { location: Location.A, excludeUserUuids: [] },
      );
    });
  });
});
