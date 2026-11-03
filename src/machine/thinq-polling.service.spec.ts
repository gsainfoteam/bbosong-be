import { Logger } from '@nestjs/common';
import { ThinqPollingService } from './thinq-polling.service';

jest.mock('@lib/database/repositories/machine.repository', () => ({}));
jest.mock('./machine.service', () => ({}));
jest.mock('generated/prisma/client', () =>
  jest.requireActual<typeof import('../../generated/prisma/enums')>(
    '../../generated/prisma/enums',
  ),
);

describe('ThinQ reconcile polling', () => {
  const dryer = {
    uuid: 'dryer',
    type: 'DRYER',
    status: 'IDLE',
    thinqDeviceId: 'device-1',
    macAddress: null,
    matterPayload: null,
    isCommissioned: null,
  };
  const thinq = {
    enabled: true,
    pollIntervalMs: 600_000,
    getDevices: jest.fn(),
    getDryerState: jest.fn(),
  };
  const repository = { getMachines: jest.fn() };
  const machines = { updateThinqDryerState: jest.fn() };
  const mqtt = { rememberDeviceState: jest.fn() };
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
      mqtt as never,
    );
  });
  afterEach(async () => {
    await service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('queries the list before a startup snapshot of mapped dryers and refreshes the list every 15 minutes', async () => {
    repository.getMachines.mockResolvedValue([
      dryer,
      {
        uuid: 'washer',
        type: 'WASHER',
        thinqDeviceId: 'device-2',
        status: 'IDLE',
      },
      { uuid: 'unmapped', type: 'DRYER', thinqDeviceId: null, status: 'IDLE' },
      {
        uuid: 'missing',
        type: 'DRYER',
        thinqDeviceId: 'unknown',
        status: 'IDLE',
      },
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
    await jest.advanceTimersByTimeAsync(600_000);
    // Idle dryers are not reconciled after the startup snapshot.
    expect(thinq.getDryerState).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(600_000);
    expect(thinq.getDevices).toHaveBeenCalledTimes(2);
  });

  it('reconciles only DRY mapped dryers after the startup snapshot', async () => {
    repository.getMachines.mockResolvedValue([
      { ...dryer, status: 'DRY' },
      {
        ...dryer,
        uuid: 'idle-dryer',
        thinqDeviceId: 'device-2',
        status: 'IDLE',
      },
    ]);
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(thinq.getDryerState).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(600_000);
    expect(thinq.getDryerState).toHaveBeenCalledTimes(3);
    expect(thinq.getDryerState).toHaveBeenLastCalledWith('device-1');
  });

  it('does no work when ThinQ is disabled', async () => {
    thinq.enabled = false;
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(1_800_000);
    expect(thinq.getDevices).not.toHaveBeenCalled();
    expect(repository.getMachines).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('retries initialization after a list error without querying states first', async () => {
    thinq.getDevices.mockRejectedValueOnce(new Error('unavailable'));
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(thinq.getDryerState).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(600_000);
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
    expect(mqtt.rememberDeviceState).toHaveBeenCalledWith('device-2', {
      runState: { currentState: 'RUNNING' },
    });
  });

  it('retries a full startup snapshot when any dryer reconcile fails', async () => {
    thinq.getDryerState.mockRejectedValueOnce(new Error('timeout'));
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(thinq.getDryerState).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(600_000);
    expect(thinq.getDryerState).toHaveBeenCalledTimes(2);
  });

  it('re-reads mappings and deletions each cycle for DRY dryers', async () => {
    repository.getMachines.mockResolvedValue([{ ...dryer, status: 'DRY' }]);
    service.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    repository.getMachines.mockResolvedValue([
      { ...dryer, thinqDeviceId: 'device-2', status: 'DRY' },
    ]);
    await jest.advanceTimersByTimeAsync(600_000);
    expect(thinq.getDryerState).toHaveBeenLastCalledWith('device-2');
    repository.getMachines.mockResolvedValue([]);
    await jest.advanceTimersByTimeAsync(600_000);
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
    await jest.advanceTimersByTimeAsync(1_800_000);
    expect(thinq.getDryerState).toHaveBeenCalledTimes(1);
    const shutdown = service.onModuleDestroy();
    resolve({ runState: { currentState: 'END' } });
    await shutdown;
    expect(machines.updateThinqDryerState).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_800_000);
    expect(thinq.getDryerState).toHaveBeenCalledTimes(1);
  });
});
