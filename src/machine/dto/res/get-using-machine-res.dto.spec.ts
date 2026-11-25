import { GetActiveUsingMachineResDto } from './get-using-machine-res.dto';

describe('GetActiveUsingMachineResDto', () => {
  const usage = {
    uuid: 'usage-1',
    machineUuid: 'machine-1',
    userUuid: 'user-1',
    notifyOnCompletion: true,
    startedAt: new Date('2026-08-01T14:23:11.000Z'),
    endedAt: null,
    estimatedEndsAt: new Date('2026-08-01T15:00:00.000Z'),
  };

  it('exposes the machine ThinQ remaining minutes and update time', () => {
    const thinqUpdatedAt = new Date('2026-08-01T14:50:00.000Z');

    expect(
      new GetActiveUsingMachineResDto({
        ...usage,
        thinqRemainingMinutes: 20,
        thinqUpdatedAt,
      }),
    ).toEqual({
      ...usage,
      remainingMinutes: 20,
      thinqUpdatedAt,
    });
  });

  it('returns null timer fields when ThinQ data is unavailable', () => {
    expect(
      new GetActiveUsingMachineResDto({
        ...usage,
        thinqRemainingMinutes: null,
        thinqUpdatedAt: null,
      }),
    ).toMatchObject({ remainingMinutes: null, thinqUpdatedAt: null });
  });
});
