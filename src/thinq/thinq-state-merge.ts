import type { ThinqDryerState } from './thinq.service';

/**
 * ThinQ MQTT push/event reports are partial: only changed fields appear.
 * Merge into the previous snapshot so omitted timer/runState fields are kept.
 */
export function mergeThinqDryerReport(
  previous: ThinqDryerState | undefined,
  report: ThinqDryerState | null | undefined,
): ThinqDryerState {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return previous ?? {};
  }
  const next: ThinqDryerState = {
    runState: previous?.runState ? { ...previous.runState } : undefined,
    timer: previous?.timer ? { ...previous.timer } : undefined,
  };
  if (report.runState && typeof report.runState === 'object') {
    next.runState = { ...next.runState, ...report.runState };
  }
  if (report.timer && typeof report.timer === 'object') {
    next.timer = { ...next.timer, ...report.timer };
  }
  return next;
}
