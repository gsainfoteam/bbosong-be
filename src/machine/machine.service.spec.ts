import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
    getMachineTypeByMacAddress: jest.fn(),
    updateMachine: jest.fn(),
    updateThinqDryerState: jest.fn(),
    recordMachinePowerByMacAddress: jest.fn(),
    updateMachineStatusByMacAddress: jest.fn(),
  };
  const usingMachineRepository = {
    confirmCompletedAndRegister: jest.fn(),
    finishUsingMachine: jest.fn(),
    enableMachineNotification: jest.fn(),
    getUsingMachineByMachineUuid: jest.fn(),
    createUsingMachine: jest.fn(),
  };
  let service: MachineService;
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
      {} as never,
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
    expect(
      usingMachineRepository.getUsingMachineByMachineUuid,
    ).not.toHaveBeenCalled();
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

    it.each(['RUNNING', 'DETECTING', 'COOLING', 'PAUSE', 'WRINKLE_CARE'])(
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

    it.each(['END', 'POWER_OFF', 'SLEEP', 'INITIAL'])(
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
});
