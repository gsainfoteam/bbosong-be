import {
  Gender,
  Location,
  MachineStatus,
  MachineType,
} from 'generated/prisma/client';
import { GetMachineDetailResDto } from './get-machine-detail-res.dto';

describe('GetMachineDetailResDto', () => {
  const usage = {
    uuid: 'usage',
    machineUuid: 'machine',
    userUuid: 'user',
    notifyOnCompletion: true,
    startedAt: new Date('2026-11-01T00:00:00.000Z'),
    endedAt: null,
  };

  const machine = {
    uuid: 'machine',
    type: MachineType.DRYER,
    location: Location.A,
    gender: Gender.MALE,
    index: 1,
    isAvailable: true,
    posX: null,
    posY: null,
    status: MachineStatus.DRY,
    shortUrl: null,
    shortCode: null,
    thinqDeviceId: 'device',
    thinqCurrentState: 'RUNNING',
    thinqRemainingMinutes: 20,
    thinqUpdatedAt: new Date('2026-11-01T00:10:00.000Z'),
    currentUsage: usage,
  };

  it('copies ThinQ remaining minutes onto currentUsage', () => {
    const dto = new GetMachineDetailResDto(machine as never, {
      isOnline: null,
      lastSeenAt: null,
    });
    expect(dto.thinqRemainingMinutes).toBe(20);
    expect(dto.currentUsage).toMatchObject({
      uuid: 'usage',
      startedAt: usage.startedAt,
      remainingMinutes: 20,
    });
  });

  it('leaves remainingMinutes null when the machine has no ThinQ timer', () => {
    const dto = new GetMachineDetailResDto(
      {
        ...machine,
        type: MachineType.WASHER,
        thinqDeviceId: null,
        thinqCurrentState: null,
        thinqRemainingMinutes: null,
        thinqUpdatedAt: null,
      } as never,
      { isOnline: true, lastSeenAt: new Date() },
    );
    expect(dto.currentUsage?.remainingMinutes ?? null).toBeNull();
  });
});
