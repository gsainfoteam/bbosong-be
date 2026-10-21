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
  };
  const usingMachineRepository = {
    confirmCompletedAndRegister: jest.fn(),
    finishUsingMachine: jest.fn(),
    enableMachineNotification: jest.fn(),
    getUsingMachineByMachineUuid: jest.fn(),
  };
  let service: MachineService;
  const notificationService = {
    notifyMachineReregistered: jest.fn(),
    notifyMachineCompletion: jest.fn(),
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
});
