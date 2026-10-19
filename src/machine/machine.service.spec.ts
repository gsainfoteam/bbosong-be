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
jest.mock('src/common/utils/format-error.util', () => ({}), { virtual: true });
jest.mock('../notification/notification.service', () => ({}));
jest.mock('./shlink.service', () => ({}));

describe('MachineService gender restrictions', () => {
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
    getMachineWithUsage: jest.fn(),
    getMachineWithUsageByShortCode: jest.fn(),
  };
  const usingMachineRepository = {
    enableMachineNotification: jest.fn(),
  };
  let service: MachineService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new MachineService(
      machineRepository as never,
      usingMachineRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    machineRepository.getMachineWithUsage.mockResolvedValue(machine);
    machineRepository.getMachineWithUsageByShortCode.mockResolvedValue(machine);
    usingMachineRepository.enableMachineNotification.mockResolvedValue(1);
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
  });

  it('preserves existing registration conflict checks', async () => {
    usingMachineRepository.enableMachineNotification.mockResolvedValue(0);
    await expect(
      service.enableMachineNotification(userUuid, machineUuid, Gender.MALE),
    ).rejects.toThrow(NotFoundException);
  });
});
