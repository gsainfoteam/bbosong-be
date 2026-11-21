/**
 * State of the dryer as shown by the iOS Live Activity. The keys of
 * {@link LiveActivityContentState} must match the Swift `ContentState`
 * `Codable` keys exactly. All times are epoch seconds.
 */
export const LIVE_ACTIVITY_STATES = [
  'RUNNING',
  'COOLING',
  'PAUSE',
  'DETECTING',
  'END',
  'ERROR',
] as const;
export type LiveActivityState = (typeof LIVE_ACTIVITY_STATES)[number];

export interface LiveActivityContentState {
  state: LiveActivityState;
  /** Estimated finish time; null while the remaining time is unknown. */
  endsAt: number | null;
  remainingMinutes: number | null;
  /** When this state was computed; lets the app correct elapsed time. */
  updatedAt: number;
}

/** Content state pushed when the session is over. */
export function buildEndContentState(now: Date): LiveActivityContentState {
  const seconds = Math.floor(now.getTime() / 1000);
  return {
    state: 'END',
    endsAt: seconds,
    remainingMinutes: 0,
    updatedAt: seconds,
  };
}

/**
 * Maps a ThinQ dryer `runState.currentState` to the Live Activity state.
 * Only used while a session is open, so post-dry states mean the cycle is over
 * and anything unknown is treated as still running.
 */
export function mapThinqStateToLiveActivityState(
  thinqState: string | null | undefined,
): LiveActivityState {
  switch (thinqState) {
    case 'COOLING':
    case 'PAUSE':
    case 'DETECTING':
    case 'ERROR':
      return thinqState;
    case 'END':
    case 'POWER_OFF':
    case 'SLEEP':
    case 'INITIAL':
    case 'WRINKLE_CARE':
      return 'END';
    default:
      return 'RUNNING';
  }
}

/** Content state for a running dryer, with the finish time projected from `now`. */
export function buildRunningContentState(
  thinqState: string | null | undefined,
  remainingMinutes: number | null,
  now: Date,
): LiveActivityContentState {
  const seconds = Math.floor(now.getTime() / 1000);
  return {
    state: mapThinqStateToLiveActivityState(thinqState),
    endsAt: remainingMinutes === null ? null : seconds + remainingMinutes * 60,
    remainingMinutes,
    updatedAt: seconds,
  };
}
