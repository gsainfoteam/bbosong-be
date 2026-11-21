import { LiveActivityEnvironment } from '../../../generated/prisma/enums';
import { LiveActivityService } from './live-activity.service';

jest.mock('@lib/logger', () => ({ Loggable: () => () => undefined }));
jest.mock('@lib/database/repositories/live-activity.repository', () => ({}));
jest.mock('./apns.service', () => ({}));
jest.mock(
  'generated/prisma/client',
  () =>
    jest.requireActual<typeof import('../../../generated/prisma/enums')>(
      '../../../generated/prisma/enums',
    ),
  { virtual: true },
);

describe('LiveActivityService', () => {
  const now = new Date('2026-11-21T03:00:00Z');
  const repository = {
    upsertToken: jest.fn(),
    deleteStale: jest.fn(),
    deleteUserToken: jest.fn(),
    getTokensByUsingMachine: jest.fn(),
    deleteByUsingMachine: jest.fn(),
  };
  const apns = { sendLiveActivityEnd: jest.fn() };
  let service: LiveActivityService;

  beforeEach(() => {
    jest.resetAllMocks();
    repository.deleteStale.mockResolvedValue(0);
    service = new LiveActivityService(repository as never, apns as never);
  });

  it('stores the token and purges stale ones', async () => {
    const params = {
      userUuid: 'user-1',
      usingMachineUuid: 'usage-1',
      pushToken: 'ab12',
      environment: LiveActivityEnvironment.SANDBOX,
    };
    await service.registerToken(params);
    expect(repository.upsertToken).toHaveBeenCalledWith(params);
    expect(repository.deleteStale).toHaveBeenCalledWith(expect.any(Date));
  });

  it('does not fail a registration when the purge fails', async () => {
    repository.deleteStale.mockRejectedValue(new Error('db'));
    await expect(
      service.registerToken({
        userUuid: 'user-1',
        usingMachineUuid: 'usage-1',
        pushToken: 'ab12',
        environment: LiveActivityEnvironment.PRODUCTION,
      }),
    ).resolves.toBeUndefined();
  });

  it("removes only the user's own token on unregister", async () => {
    await service.unregisterToken('user-1', 'ab12');
    expect(repository.deleteUserToken).toHaveBeenCalledWith('user-1', 'ab12');
  });

  it('ends every device of the session and forgets the tokens', async () => {
    const tokens = [
      { pushToken: 'aa', environment: LiveActivityEnvironment.PRODUCTION },
      { pushToken: 'bb', environment: LiveActivityEnvironment.SANDBOX },
    ];
    repository.getTokensByUsingMachine.mockResolvedValue(tokens);
    apns.sendLiveActivityEnd
      .mockResolvedValueOnce('sent')
      .mockResolvedValueOnce('dead-token');

    await service.endForUsingMachine('usage-1', now);

    expect(apns.sendLiveActivityEnd).toHaveBeenCalledTimes(2);
    expect(apns.sendLiveActivityEnd).toHaveBeenCalledWith(
      tokens[0],
      expect.objectContaining({ state: 'END' }),
      now,
    );
    expect(repository.deleteByUsingMachine).toHaveBeenCalledWith('usage-1');
  });

  it('does nothing for a session without Live Activities', async () => {
    repository.getTokensByUsingMachine.mockResolvedValue([]);
    await service.endForUsingMachine('usage-1', now);
    expect(apns.sendLiveActivityEnd).not.toHaveBeenCalled();
    expect(repository.deleteByUsingMachine).not.toHaveBeenCalled();
  });
});
