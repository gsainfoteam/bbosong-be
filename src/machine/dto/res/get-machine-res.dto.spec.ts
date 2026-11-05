import {
  Gender,
  Location,
  MachineStatus,
  MachineType,
} from 'generated/prisma/client';
import { GetMachineResDto } from './get-machine-res.dto';

describe('GetMachineResDto', () => {
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

  it('includes currentUsage with startedAt for list responses', () => {
    const dto = new GetMachineResDto(machine as never, {
      isOnline: null,
      lastSeenAt: null,
    });

    expect(dto.currentUsage).toMatchObject({
      uuid: 'usage',
      userUuid: 'user',
      notifyOnCompletion: true,
      startedAt: usage.startedAt,
      remainingMinutes: 20,
    });
  });

  it('sets currentUsage to null when there is no open usage session', () => {
    const dto = new GetMachineResDto(
      { ...machine, status: MachineStatus.IDLE, currentUsage: null } as never,
      { isOnline: null, lastSeenAt: null },
    );

    expect(dto.currentUsage).toBeNull();
  });
});
