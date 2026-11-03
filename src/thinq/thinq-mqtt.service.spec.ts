import { Logger } from '@nestjs/common';
import { ThinqMqttService } from './thinq-mqtt.service';

jest.mock('@lib/database/repositories/machine.repository', () => ({}));
jest.mock('../machine/machine.service', () => ({}));
jest.mock('generated/prisma/client', () =>
  jest.requireActual<typeof import('../../generated/prisma/enums')>(
    '../../generated/prisma/enums',
  ),
);
jest.mock('mqtt', () => ({
  __esModule: true,
  default: { connect: jest.fn() },
}));
jest.mock('node-forge', () => {
  const actual = jest.requireActual<typeof import('node-forge')>('node-forge');
  return actual;
});

describe('ThinQ MQTT service', () => {
  const thinq = {
    enabled: true,
    thinqClientId: 'client',
    getMqttHost: jest.fn(),
    registerMqttClient: jest.fn(),
    unregisterMqttClient: jest.fn(),
    issueMqttCertificate: jest.fn(),
    subscribeDeviceEvent: jest.fn(),
    unsubscribeDeviceEvent: jest.fn(),
  };
  const repository = { getMachines: jest.fn() };
  const machines = { updateThinqDryerState: jest.fn() };
  let service: ThinqMqttService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    thinq.enabled = true;
    thinq.subscribeDeviceEvent.mockResolvedValue(undefined);
    thinq.unsubscribeDeviceEvent.mockResolvedValue(undefined);
    machines.updateThinqDryerState.mockResolvedValue(undefined);
    repository.getMachines.mockResolvedValue([
      {
        uuid: 'dryer',
        type: 'DRYER',
        thinqDeviceId: 'device-1',
      },
    ]);
    service = new ThinqMqttService(
      thinq as never,
      repository as never,
      machines as never,
    );
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  it('merges partial push reports and updates the mapped dryer', async () => {
    await service.handlePushPayload({
      deviceId: 'device-1',
      report: {
        runState: { currentState: 'RUNNING' },
        timer: { remainHour: 1, remainMinute: 0 },
      },
    });
    await service.handlePushPayload({
      deviceId: 'device-1',
      report: { timer: { remainMinute: 59 } },
    });
    expect(machines.updateThinqDryerState).toHaveBeenLastCalledWith(
      'dryer',
      'device-1',
      {
        runState: { currentState: 'RUNNING' },
        timer: { remainHour: 1, remainMinute: 59 },
      },
    );
  });

  it('ignores pushes for unmapped devices', async () => {
    await service.handlePushPayload({
      deviceId: 'unknown',
      report: { runState: { currentState: 'RUNNING' } },
    });
    expect(machines.updateThinqDryerState).not.toHaveBeenCalled();
  });

  it('does not connect when ThinQ is disabled', () => {
    thinq.enabled = false;
    service.onModuleInit();
    expect(thinq.getMqttHost).not.toHaveBeenCalled();
    expect(thinq.registerMqttClient).not.toHaveBeenCalled();
  });
});
