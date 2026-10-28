import { Logger } from '@nestjs/common';
import { ThinqPollingService } from './thinq-polling.service';

jest.mock('@lib/database/repositories/machine.repository', () => ({}));
jest.mock('./machine.service', () => ({}));
jest.mock('generated/prisma/client', () =>
  jest.requireActual<typeof import('../../generated/prisma/enums')>(
    '../../generated/prisma/enums',
  ),
);

describe('ThinQ polling', () => {
  const dryer = { uuid: 'dryer', type: 'DRYER', thinqDeviceId: 'device-1' };
  const thinq = {
    enabled: true,
    pollIntervalMs: 60_000,
    getDevices: jest.fn(),
    getDryerState: jest.fn(),
  };
  const repository = { getMachines: jest.fn() };
  const machines = { updateThinqDryerState: jest.fn() };
  let service: ThinqPollingService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    thinq.enabled = true;
    thinq.getDevices.mockResolvedValue([
      { deviceId: 'device-1' },
      { deviceId: 'device-2' },
    ]);
    thinq.getDryerState.mockResolvedValue({
      runState: { currentState: 'RUNNING' },
    });
    repository.getMachines.mockResolvedValue([dryer]);
    machines.updateThinqDryerState.mockResolvedValue(undefined);
    service = new ThinqPollingService(
      thinq as never,
      repository as never,
      machines as never,
    );
  });
  afterEach(async () => {
    await service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('queries the list before states, polls only mapped dryers and refreshes the list every 15 minutes', async () => {
    repository.getMachines.mockResolvedValue([
      dryer,
      { uuid: 'washer', type: 'WASHER', thinqDeviceId: 'device-2' },
      { uuid: 'unmapped', type: 'DRYER', thinqDeviceId: null },
      { uuid: 'missing', type: 'DRYER', thinqDeviceId: 'unknown' },
    ]);
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(thinq.getDevices.mock.invocationCallOrder[0]).toBeLessThan(
      thinq.getDryerState.mock.invocationCallOrder[0],
    );
    expect(thinq.getDryerState).toHaveBeenCalledTimes(1);
    expect(thinq.getDryerState).toHaveBeenCalledWith('device-1');
    expect(machines.updateThinqDryerState).toHaveBeenCalledWith(
      'dryer',
      'device-1',
      { runState: { currentState: 'RUNNING' } },
    );
    await jest.advanceTimersByTimeAsync(60_000);
    expect(thinq.getDevices).toHaveBeenCalledTimes(1);
    expect(thinq.getDryerState).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(840_000);
    expect(thinq.getDevices).toHaveBeenCalledTimes(2);
  });

  it('does no work when ThinQ is disabled', async () => {
    thinq.enabled = false;
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(180_000);
    expect(thinq.getDevices).not.toHaveBeenCalled();
    expect(repository.getMachines).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retries initialization after a list error without querying states first', async () => {
    thinq.getDevices.mockRejectedValueOnce(new Error('unavailable'));
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(thinq.getDryerState).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(thinq.getDryerState).toHaveBeenCalledTimes(1);
  });

  it('preserves states on HTTP errors and continues with the next dryer', async () => {
    repository.getMachines.mockResolvedValue([
      dryer,
      { ...dryer, uuid: 'dryer-2', thinqDeviceId: 'device-2' },
    ]);
    thinq.getDryerState.mockRejectedValueOnce(new Error('timeout'));
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(machines.updateThinqDryerState).toHaveBeenCalledTimes(1);
    expect(machines.updateThinqDryerState).toHaveBeenCalledWith(
      'dryer-2',
      'device-2',
      { runState: { currentState: 'RUNNING' } },
    );
  });

  it('re-reads mappings and deletions each cycle', async () => {
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    repository.getMachines.mockResolvedValue([
      { ...dryer, thinqDeviceId: 'device-2' },
    ]);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(thinq.getDryerState).toHaveBeenLastCalledWith('device-2');
    repository.getMachines.mockResolvedValue([]);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(thinq.getDryerState).toHaveBeenCalledTimes(2);
  });

  it('never overlaps cycles and waits for in-flight HTTP on shutdown without applying its result', async () => {
    let resolve!: (state: object) => void;
    thinq.getDryerState.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(180_000);
    expect(thinq.getDryerState).toHaveBeenCalledTimes(1);
    const shutdown = service.onModuleDestroy();
    resolve({ runState: { currentState: 'END' } });
    await shutdown;
    expect(machines.updateThinqDryerState).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(180_000);
    expect(thinq.getDryerState).toHaveBeenCalledTimes(1);
  });
});
