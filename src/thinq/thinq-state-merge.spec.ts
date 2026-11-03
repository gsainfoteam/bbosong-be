import { mergeThinqDryerReport } from './thinq-state-merge';

describe('mergeThinqDryerReport', () => {
  it('keeps previous remainHour when only remainMinute is pushed', () => {
    expect(
      mergeThinqDryerReport(
        {
          runState: { currentState: 'RUNNING' },
          timer: { remainHour: 1, remainMinute: 0 },
        },
        { timer: { remainMinute: 59 } },
      ),
    ).toEqual({
      runState: { currentState: 'RUNNING' },
      timer: { remainHour: 1, remainMinute: 59 },
    });
  });

  it('updates runState without dropping the cached timer', () => {
    expect(
      mergeThinqDryerReport(
        {
          runState: { currentState: 'RUNNING' },
          timer: { remainHour: 0, remainMinute: 40 },
        },
        { runState: { currentState: 'END' } },
      ),
    ).toEqual({
      runState: { currentState: 'END' },
      timer: { remainHour: 0, remainMinute: 40 },
    });
  });

  it('starts from an empty cache', () => {
    expect(
      mergeThinqDryerReport(undefined, {
        runState: { currentState: 'INITIAL' },
      }),
    ).toEqual({ runState: { currentState: 'INITIAL' }, timer: undefined });
  });

  it('ignores malformed reports', () => {
    const previous = { runState: { currentState: 'PAUSE' } };
    expect(mergeThinqDryerReport(previous, null)).toEqual(previous);
    expect(mergeThinqDryerReport(previous, undefined)).toEqual(previous);
    expect(mergeThinqDryerReport(previous, [] as never)).toEqual(previous);
  });
});
