import {
  buildEndContentState,
  buildRunningContentState,
  mapThinqStateToLiveActivityState,
} from './live-activity.type';

describe('live activity content state', () => {
  const now = new Date('2026-11-21T03:00:00Z');
  const seconds = Math.floor(now.getTime() / 1000);

  it.each([
    ['RUNNING', 'RUNNING'],
    ['COOLING', 'COOLING'],
    ['PAUSE', 'PAUSE'],
    ['DETECTING', 'DETECTING'],
    ['ERROR', 'ERROR'],
    ['END', 'END'],
    ['POWER_OFF', 'END'],
    ['SLEEP', 'END'],
    ['INITIAL', 'END'],
    ['WRINKLE_CARE', 'END'],
    ['SOMETHING_NEW', 'RUNNING'],
    [null, 'RUNNING'],
    [undefined, 'RUNNING'],
  ])('maps ThinQ %s to %s', (thinq, expected) => {
    expect(mapThinqStateToLiveActivityState(thinq)).toBe(expected);
  });

  it('projects the finish time from the remaining minutes', () => {
    expect(buildRunningContentState('RUNNING', 20, now)).toEqual({
      state: 'RUNNING',
      endsAt: seconds + 1200,
      remainingMinutes: 20,
      updatedAt: seconds,
    });
  });

  it('has no finish time while the remaining time is unknown', () => {
    expect(buildRunningContentState('DETECTING', null, now)).toEqual({
      state: 'DETECTING',
      endsAt: null,
      remainingMinutes: null,
      updatedAt: seconds,
    });
  });

  it('builds the done state', () => {
    expect(buildEndContentState(now)).toEqual({
      state: 'END',
      endsAt: seconds,
      remainingMinutes: 0,
      updatedAt: seconds,
    });
  });
});
