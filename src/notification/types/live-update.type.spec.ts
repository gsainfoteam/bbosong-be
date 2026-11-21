import { MachineType } from 'generated/prisma/client';
import {
  buildLiveUpdateData,
  buildLiveUpdateSession,
} from './live-update.type';

describe('live-update type', () => {
  const machine = {
    uuid: 'machine-1',
    type: MachineType.DRYER,
    location: 'A' as const,
    index: 3,
  };

  it('builds the session title and kind', () => {
    expect(buildLiveUpdateSession(machine, null)).toEqual({
      machineUuid: 'machine-1',
      kind: 'DRYER',
      title: 'A동 건조기 3번',
      startedAt: null,
    });
    expect(
      buildLiveUpdateSession({ ...machine, type: MachineType.WASHER }, null)
        .title,
    ).toBe('A동 세탁기 3번');
  });

  it('serializes numbers as strings', () => {
    const session = buildLiveUpdateSession(
      machine,
      new Date('2026-11-21T00:00:00Z'),
    );
    expect(
      buildLiveUpdateData(session, {
        state: 'RUNNING',
        endsAt: 1790001200,
        remainingMinutes: 20,
        updatedAt: 1790000000,
      }),
    ).toEqual({
      type: 'LIVE_UPDATE',
      machineUuid: 'machine-1',
      kind: 'DRYER',
      title: 'A동 건조기 3번',
      startedAt: '1795219200',
      state: 'RUNNING',
      endsAt: '1790001200',
      remainingMinutes: '20',
      updatedAt: '1790000000',
    });
  });

  it('omits null values instead of sending empty strings', () => {
    const data = buildLiveUpdateData(buildLiveUpdateSession(machine, null), {
      state: 'DETECTING',
      endsAt: null,
      remainingMinutes: null,
      updatedAt: 1790000000,
    });
    expect(data).not.toHaveProperty('endsAt');
    expect(data).not.toHaveProperty('remainingMinutes');
    expect(data).not.toHaveProperty('startedAt');
  });
});
