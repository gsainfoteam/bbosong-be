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
    {
      userUuid: 'user-1',
      pushToken: 'aa',
      environment: LiveActivityEnvironment.PRODUCTION,
    },
    {
      userUuid: 'user-1',
      pushToken: 'bb',
      environment: LiveActivityEnvironment.SANDBOX,
    },
  ];
  const repository = {
    upsertToken: jest.fn(),
    deleteStale: jest.fn(),
    deleteUserToken: jest.fn(),
    deleteTokens: jest.fn(),
    getTokensByUsingMachine: jest.fn(),
    getUserTokensOnMachine: jest.fn(),
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
      await service.completeForUsingMachine('usage-1', 'user-1', now);
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
      await service.completeForUsingMachine('usage-1', 'user-1', now);
      expect(repository.deleteTokens).toHaveBeenCalledWith(['bb']);
    });
  });

  describe('users who stopped tracking the session', () => {
    const orphan = {
      userUuid: 'user-2',
      pushToken: 'cc',
      environment: LiveActivityEnvironment.PRODUCTION,
    };

    beforeEach(() => {
      repository.getTokensByUsingMachine.mockResolvedValue([tokens[0], orphan]);
    });

    it('only ends their activity when the session completes', async () => {
      await service.completeForUsingMachine('usage-1', 'user-1', now);
      expect(apns.sendLiveActivityEnd).toHaveBeenCalledTimes(1);
      expect(apns.sendLiveActivityEnd).toHaveBeenCalledWith(
        orphan,
        expect.anything(),
        now,
      );
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(1);
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledWith(
        tokens[0],
        expect.anything(),
        { highPriority: true },
        now,
      );
    });

    it('retries ending them instead of updating them while running', async () => {
      await service.syncRunning(
        'usage-1',
        'user-1',
        { state: 'RUNNING', remainingMinutes: 30 },
        now,
      );
      expect(apns.sendLiveActivityEnd).toHaveBeenCalledWith(
        orphan,
        expect.anything(),
        now,
      );
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(1);
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalledWith(
        orphan,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
      expect(repository.deleteTokens).toHaveBeenCalledWith(['cc']);
    });

    it('treats every token as orphaned once the session has no user', async () => {
      await service.completeForUsingMachine('usage-1', null, now);
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
      expect(apns.sendLiveActivityEnd).toHaveBeenCalledTimes(2);
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

    it('keeps tokens whose end could not be delivered', async () => {
      apns.sendLiveActivityEnd
        .mockResolvedValueOnce('failed')
        .mockResolvedValueOnce('dead-token');
      await service.endForUsingMachine('usage-1', now);
      expect(repository.deleteTokens).toHaveBeenCalledWith(['bb']);
    });

    it('does nothing for a session without Live Activities', async () => {
      repository.getTokensByUsingMachine.mockResolvedValue([]);
      await service.endForUsingMachine('usage-1', now);
      expect(apns.sendLiveActivityEnd).not.toHaveBeenCalled();
      expect(repository.deleteTokens).not.toHaveBeenCalled();
    });
  });

  describe('endForUserOnMachine', () => {
    it("ends the user's Live Activities on the machine and forgets them", async () => {
      repository.getUserTokensOnMachine.mockResolvedValue(tokens);
      await service.endForUserOnMachine('user-1', 'machine-1', now);
      expect(repository.getUserTokensOnMachine).toHaveBeenCalledWith(
        'user-1',
        'machine-1',
      );
      expect(apns.sendLiveActivityEnd).toHaveBeenCalledTimes(2);
      expect(repository.deleteTokens).toHaveBeenCalledWith(['aa', 'bb']);
    });

    it('does nothing when the user has none', async () => {
      repository.getUserTokensOnMachine.mockResolvedValue([]);
      await service.endForUserOnMachine('user-1', 'machine-1', now);
      expect(apns.sendLiveActivityEnd).not.toHaveBeenCalled();
    });
  });

  describe('pushOverdue', () => {
    const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
    const running = (remainingMinutes: number | null) => ({
      state: 'RUNNING',
      remainingMinutes,
    });

    it('pushes once after the finish time passed, with 0 minutes left', async () => {
      await service.syncRunning('usage-1', 'user-1', running(20), now);
      apns.sendLiveActivityUpdate.mockClear();

      await service.pushOverdue(at(20 * 60_000 - 1000));
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();

      await service.pushOverdue(at(20 * 60_000));
      await service.pushOverdue(at(25 * 60_000));
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(2);
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledWith(
        tokens[0],
        {
          state: 'RUNNING',
          endsAt: seconds + 20 * 60,
          remainingMinutes: 0,
          updatedAt: seconds + 20 * 60,
        },
        { highPriority: true },
        at(20 * 60_000),
      );
    });

    it('does nothing without a finish time', async () => {
      await service.syncRunning('usage-1', 'user-1', running(null), now);
      apns.sendLiveActivityUpdate.mockClear();
      await service.pushOverdue(at(3600_000));
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
    });

    it('is armed again when the finish time moves ahead', async () => {
      await service.syncRunning('usage-1', 'user-1', running(20), now);
      await service.pushOverdue(at(21 * 60_000));
      apns.sendLiveActivityUpdate.mockClear();

      // Time entered again: 10 more minutes from 21 minutes in.
      await service.syncRunning(
        'usage-1',
        'user-1',
        running(10),
        at(21 * 60_000),
      );
      apns.sendLiveActivityUpdate.mockClear();
      await service.pushOverdue(at(30 * 60_000));
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
      await service.pushOverdue(at(31 * 60_000));
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(2);
    });

    it('retries a failed device a limited number of times', async () => {
      await service.syncRunning('usage-1', 'user-1', running(20), now);
      apns.sendLiveActivityUpdate.mockClear();
      apns.sendLiveActivityUpdate.mockResolvedValue('failed');
      for (let i = 0; i < 6; i++) {
        await service.pushOverdue(at(21 * 60_000 + i * 15_000));
      }
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(3 * 2);
    });

    it('is re-armed by a small extension that is not worth a push', async () => {
      await service.syncRunning('usage-1', 'user-1', running(20), now);
      await service.pushOverdue(at(20 * 60_000));
      apns.sendLiveActivityUpdate.mockClear();

      // 1 more minute (below the 2 minute drift): nothing is pushed, but it is tracked.
      await service.syncRunning(
        'usage-1',
        'user-1',
        running(1),
        at(20 * 60_000 + 1000),
      );
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
      await service.pushOverdue(at(21 * 60_000 + 1000));
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(2);
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledWith(
        tokens[0],
        expect.objectContaining({
          endsAt: seconds + 20 * 60 + 1 + 60,
          remainingMinutes: 0,
        }),
        { highPriority: true },
        at(21 * 60_000 + 1000),
      );
    });

    it('uses the latest finish time when a recent change was throttled', async () => {
      await service.syncRunning('usage-1', 'user-1', running(30), now);
      apns.sendLiveActivityUpdate.mockClear();
      // Changed 30 s later: throttled, but the overdue time must follow it.
      await service.syncRunning('usage-1', 'user-1', running(40), at(30_000));
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
      await service.pushOverdue(at(30 * 60_000 + 1000));
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
    });

    it('pushes a forced (user-entered) change despite the throttle and drift limits', async () => {
      await service.syncRunning('usage-1', 'user-1', running(30), now);
      apns.sendLiveActivityUpdate.mockClear();
      await service.syncRunning('usage-1', 'user-1', running(29), at(10_000), {
        force: true,
      });
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(2);
    });

    it('tries again after the token lookup failed', async () => {
      await service.syncRunning('usage-1', 'user-1', running(20), now);
      apns.sendLiveActivityUpdate.mockClear();
      repository.getTokensByUsingMachine.mockRejectedValueOnce(new Error('db'));

      await service.pushOverdue(at(20 * 60_000));
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
      await service.pushOverdue(at(20 * 60_000 + 15_000));
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(2);
    });

    it('stops after the session completed', async () => {
      await service.syncRunning('usage-1', 'user-1', running(20), now);
      await service.completeForUsingMachine('usage-1', 'user-1', now);
      apns.sendLiveActivityUpdate.mockClear();
      await service.pushOverdue(at(25 * 60_000));
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
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
      await service.syncRunning('usage-1', 'user-1', running(30), now);
      expect(repository.getTokensByUsingMachine).not.toHaveBeenCalled();
    });

    it('sends the first update with the projected finish time', async () => {
      await service.syncRunning('usage-1', 'user-1', running(30), now);
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
      await service.syncRunning('usage-1', 'user-1', running(30), now);
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
    });

    it('ignores an unchanged countdown', async () => {
      await service.syncRunning('usage-1', 'user-1', running(30), now);
      apns.sendLiveActivityUpdate.mockClear();
      // 10 minutes later the timer reads 20: same finish time.
      await service.syncRunning(
        'usage-1',
        'user-1',
        running(20),
        at(10 * 60_000),
      );
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
    });

    it('sends when the finish time drifts, at normal priority', async () => {
      await service.syncRunning('usage-1', 'user-1', running(30), now);
      apns.sendLiveActivityUpdate.mockClear();
      await service.syncRunning(
        'usage-1',
        'user-1',
        running(25),
        at(2 * 60_000),
      );
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(2);
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledWith(
        tokens[0],
        expect.objectContaining({ remainingMinutes: 25 }),
        { highPriority: false },
        at(2 * 60_000),
      );
    });

    it('throttles finish-time drift updates', async () => {
      await service.syncRunning('usage-1', 'user-1', running(30), now);
      apns.sendLiveActivityUpdate.mockClear();
      // Drift of 5 minutes but only 30 seconds after the previous push.
      await service.syncRunning('usage-1', 'user-1', running(25), at(30_000));
      expect(apns.sendLiveActivityUpdate).not.toHaveBeenCalled();
    });

    it('sends state changes right away at high priority', async () => {
      await service.syncRunning('usage-1', 'user-1', running(30), now);
      apns.sendLiveActivityUpdate.mockClear();
      await service.syncRunning(
        'usage-1',
        'user-1',
        running(30, 'PAUSE'),
        at(1_000),
      );
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledWith(
        tokens[0],
        expect.objectContaining({ state: 'PAUSE' }),
        { highPriority: true },
        at(1_000),
      );
    });

    it('sends when the remaining time becomes unknown', async () => {
      await service.syncRunning('usage-1', 'user-1', running(30), now);
      apns.sendLiveActivityUpdate.mockClear();
      await service.syncRunning(
        'usage-1',
        'user-1',
        running(null),
        at(2 * 60_000),
      );
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledWith(
        tokens[0],
        expect.objectContaining({ endsAt: null, remainingMinutes: null }),
        { highPriority: false },
        at(2 * 60_000),
      );
    });

    it('retries the same update on the next sync after a failed push', async () => {
      apns.sendLiveActivityUpdate.mockResolvedValue('failed');
      await service.syncRunning('usage-1', 'user-1', running(30, 'PAUSE'), now);
      apns.sendLiveActivityUpdate.mockClear();
      apns.sendLiveActivityUpdate.mockResolvedValue('sent');
      await service.syncRunning(
        'usage-1',
        'user-1',
        running(30, 'PAUSE'),
        at(1_000),
      );
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(2);
    });

    it('keeps the throttle of the last successful push after a failure', async () => {
      await service.syncRunning('usage-1', 'user-1', running(30), now);
      apns.sendLiveActivityUpdate.mockResolvedValue('failed');
      await service.syncRunning(
        'usage-1',
        'user-1',
        running(20, 'PAUSE'),
        at(5_000),
      );
      apns.sendLiveActivityUpdate.mockClear();
      apns.sendLiveActivityUpdate.mockResolvedValue('sent');
      // State is still PAUSE vs. the last successful RUNNING: sent again.
      await service.syncRunning(
        'usage-1',
        'user-1',
        running(20, 'PAUSE'),
        at(6_000),
      );
      expect(apns.sendLiveActivityUpdate).toHaveBeenCalledTimes(2);
    });

    it('prunes tokens APNs reports as dead', async () => {
      apns.sendLiveActivityUpdate
        .mockResolvedValueOnce('dead-token')
        .mockResolvedValueOnce('sent');
      await service.syncRunning('usage-1', 'user-1', running(30), now);
      expect(repository.deleteTokens).toHaveBeenCalledWith(['aa']);
    });
  });
});
