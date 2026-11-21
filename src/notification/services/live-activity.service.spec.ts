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
  const seconds = Math.floor(now.getTime() / 1000);
  const tokens = [
    { pushToken: 'aa', environment: LiveActivityEnvironment.PRODUCTION },
    { pushToken: 'bb', environment: LiveActivityEnvironment.SANDBOX },
  ];
  const repository = {
    upsertToken: jest.fn(),
    deleteStale: jest.fn(),
    deleteUserToken: jest.fn(),
    deleteTokens: jest.fn(),
    getTokensByUsingMachine: jest.fn(),
    getTokensOfOtherSessions: jest.fn(),
  };
  const apns = {
    isEnabled: jest.fn(),
    sendLiveActivityUpdate: jest.fn(),
    sendLiveActivityEnd: jest.fn(),
  };
  let service: LiveActivityService;

  beforeEach(() => {
    jest.resetAllMocks();
    repository.deleteStale.mockResolvedValue(0);
    repository.getTokensByUsingMachine.mockResolvedValue(tokens);
    apns.isEnabled.mockReturnValue(true);
    apns.sendLiveActivityUpdate.mockResolvedValue('sent');
    apns.sendLiveActivityEnd.mockResolvedValue('sent');
    service = new LiveActivityService(repository as never, apns as never);
  });

  describe('token registration', () => {
    const params = {
      userUuid: 'user-1',
      usingMachineUuid: 'usage-1',
      pushToken: 'ab12',
      environment: LiveActivityEnvironment.SANDBOX,
    };

    it('stores the token and purges stale ones', async () => {
      await service.registerToken(params);
      expect(repository.upsertToken).toHaveBeenCalledWith(params);
      expect(repository.deleteStale).toHaveBeenCalledWith(expect.any(Date));
    });

    it('does not fail a registration when the purge fails', async () => {
      repository.deleteStale.mockRejectedValue(new Error('db'));
      await expect(service.registerToken(params)).resolves.toBeUndefined();
    });

    it("removes only the user's own token on unregister", async () => {
      await service.unregisterToken('user-1', 'ab12');
      expect(repository.deleteUserToken).toHaveBeenCalledWith('user-1', 'ab12');
    });

    it('stores a late token and shows done on it', async () => {
      await service.registerCompletedToken(params);
      expect(repository.upsertToken).toHaveBeenCalledWith(params);
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledWith(
        params,
        expect.objectContaining({ state: 'END' }),
        { highPriority: true },
      );
      expect(repository.deleteTokens).not.toHaveBeenCalled();
    });

    it('drops a late token APNs reports as dead', async () => {
      apns.sendLiveActivityUpdate.mockResolvedValue('dead-token');
      await service.registerCompletedToken(params);
      expect(repository.deleteTokens).toHaveBeenCalledWith(['ab12']);
    });
  });

  describe('completeForUsingMachine', () => {
    it('shows done on every device but keeps the tokens', async () => {
      await service.completeForUsingMachine('usage-1', now);
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(2);
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledWith(
        tokens[0],
        expect.objectContaining({ state: 'END', remainingMinutes: 0 }),
        { highPriority: true },
        now,
      );
      expect(apns.sendLiveActivityEnd).not.toHaveBeenCalled();
      expect(repository.deleteTokens).toHaveBeenCalledWith([]);
    });

    it('removes only the dead tokens', async () => {
      apns.sendLiveActivityUpdate
        .mockResolvedValueOnce('sent')
        .mockResolvedValueOnce('dead-token');
      await service.completeForUsingMachine('usage-1', now);
      expect(repository.deleteTokens).toHaveBeenCalledWith(['bb']);
    });
  });

  describe('endForUsingMachine', () => {
    it('ends every device of the session and forgets the tokens', async () => {
      await service.endForUsingMachine('usage-1', now);
      expect(apns.sendLiveActivityEnd).toHaveBeenCalledTimes(2);
      expect(apns.sendLiveActivityEnd).toHaveBeenCalledWith(
        tokens[0],
        expect.objectContaining({ state: 'END' }),
        now,
      );
      expect(repository.deleteTokens).toHaveBeenCalledWith(['aa', 'bb']);
    });

    it('does nothing for a session without Live Activities', async () => {
      repository.getTokensByUsingMachine.mockResolvedValue([]);
      await service.endForUsingMachine('usage-1', now);
      expect(apns.sendLiveActivityEnd).not.toHaveBeenCalled();
      expect(repository.deleteTokens).not.toHaveBeenCalled();
    });
  });

  describe('endStaleForMachine', () => {
    it('ends finished sessions of the machine once per new session', async () => {
      repository.getTokensOfOtherSessions.mockResolvedValue(tokens);
      await service.endStaleForMachine('machine-1', 'usage-2', now);
      await service.endStaleForMachine('machine-1', 'usage-2', now);

      expect(repository.getTokensOfOtherSessions).toHaveBeenCalledTimes(1);
      expect(repository.getTokensOfOtherSessions).toHaveBeenCalledWith(
        'machine-1',
        'usage-2',
      );
      expect(apns.sendLiveActivityEnd).toHaveBeenCalledTimes(2);
      expect(repository.deleteTokens).toHaveBeenCalledWith(['aa', 'bb']);

      repository.getTokensOfOtherSessions.mockResolvedValue([]);
      await service.endStaleForMachine('machine-1', 'usage-3', now);
      expect(repository.getTokensOfOtherSessions).toHaveBeenCalledTimes(2);
    });
  });

  describe('syncRunning', () => {
    const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
    const running = (remainingMinutes: number | null, state = 'RUNNING') => ({
      state,
      remainingMinutes,
    });

    it('does nothing when APNs is disabled', async () => {
      apns.isEnabled.mockReturnValue(false);
      await service.syncRunning('usage-1', running(30), now);
      expect(repository.getTokensByUsingMachine).not.toHaveBeenCalled();
    });

    it('sends the first update with the projected finish time', async () => {
      await service.syncRunning('usage-1', running(30), now);
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(2);
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledWith(
        tokens[0],
        {
          state: 'RUNNING',
          endsAt: seconds + 30 * 60,
          remainingMinutes: 30,
          updatedAt: seconds,
        },
        { highPriority: true },
        now,
      );
    });

    it('does not send without registered devices', async () => {
      repository.getTokensByUsingMachine.mockResolvedValue([]);
      await service.syncRunning('usage-1', running(30), now);
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
    });

    it('ignores an unchanged countdown', async () => {
      await service.syncRunning('usage-1', running(30), now);
      apns.sendLiveActivityUpdate.mockClear();
      // 10 minutes later the timer reads 20: same finish time.
      await service.syncRunning('usage-1', running(20), at(10 * 60_000));
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
    });

    it('sends when the finish time drifts, at normal priority', async () => {
      await service.syncRunning('usage-1', running(30), now);
      apns.sendLiveActivityUpdate.mockClear();
      await service.syncRunning('usage-1', running(25), at(2 * 60_000));
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(2);
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledWith(
        tokens[0],
        expect.objectContaining({ remainingMinutes: 25 }),
        { highPriority: false },
        at(2 * 60_000),
      );
    });

    it('throttles finish-time drift updates', async () => {
      await service.syncRunning('usage-1', running(30), now);
      apns.sendLiveActivityUpdate.mockClear();
      // Drift of 5 minutes but only 30 seconds after the previous push.
      await service.syncRunning('usage-1', running(25), at(30_000));
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
    });

    it('sends state changes right away at high priority', async () => {
      await service.syncRunning('usage-1', running(30), now);
      apns.sendLiveActivityUpdate.mockClear();
      await service.syncRunning('usage-1', running(30, 'PAUSE'), at(1_000));
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledWith(
        tokens[0],
        expect.objectContaining({ state: 'PAUSE' }),
        { highPriority: true },
        at(1_000),
      );
    });

    it('sends when the remaining time becomes unknown', async () => {
      await service.syncRunning('usage-1', running(30), now);
      apns.sendLiveActivityUpdate.mockClear();
      await service.syncRunning('usage-1', running(null), at(2 * 60_000));
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledWith(
        tokens[0],
        expect.objectContaining({ endsAt: null, remainingMinutes: null }),
        { highPriority: false },
        at(2 * 60_000),
      );
    });

    it('prunes tokens APNs reports as dead', async () => {
      apns.sendLiveActivityUpdate
        .mockResolvedValueOnce('dead-token')
        .mockResolvedValueOnce('sent');
      await service.syncRunning('usage-1', running(30), now);
      expect(repository.deleteTokens).toHaveBeenCalledWith(['aa']);
    });
  });
});
