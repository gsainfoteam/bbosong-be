import { ConfigService } from '@nestjs/config';
import { BbosongConfigService } from '../../config/bbosong-config.service';
import { LiveUpdateService } from './live-update.service';
import { buildLiveUpdateSession } from '../types/live-update.type';

jest.mock('./fcm.service', () => ({}));
jest.mock('@lib/logger', () => ({ Loggable: () => () => undefined }));

describe('LiveUpdateService', () => {
  const fcmService = { sendLiveUpdateToUser: jest.fn() };
  const session = buildLiveUpdateSession(
    { uuid: 'machine-1', type: 'DRYER', location: 'A', index: 3 },
    new Date('2026-11-21T00:00:00Z'),
  );
  const now = new Date('2026-11-21T00:10:00Z');
  let service: LiveUpdateService;
  const create = (tickSeconds?: string) => {
    return new LiveUpdateService(
      fcmService as never,
      new BbosongConfigService(
        new ConfigService({ LIVE_UPDATE_TICK_INTERVAL_SECONDS: tickSeconds }),
      ),
    );
  };

  beforeEach(() => {
    jest.resetAllMocks();
    fcmService.sendLiveUpdateToUser.mockResolvedValue({ sent: 1, failed: 0 });
    service = create();
  });

  const sync = (
    state: string,
    owner: string | null = 'user-1',
    remainingMinutes: number | null = 20,
    at: Date = now,
  ) =>
    service.syncRunning(
      'session-1',
      owner,
      session,
      { state, remainingMinutes },
      at,
    );
  const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);

  it('sends only on state transitions', async () => {
    await sync('RUNNING');
    await sync('RUNNING');
    expect(fcmService.sendLiveUpdateToUser).toHaveBeenCalledTimes(1);
    expect(fcmService.sendLiveUpdateToUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ type: 'LIVE_UPDATE', state: 'RUNNING' }),
    );
    await sync('COOLING');
    expect(fcmService.sendLiveUpdateToUser).toHaveBeenCalledTimes(2);
  });

  it('sends a correction when the finish time drifts by 2 minutes or more, not for the elapsed time', async () => {
    await sync('RUNNING', 'user-1', 20);
    await sync('RUNNING', 'user-1', 19, later(60)); // same finish time
    expect(fcmService.sendLiveUpdateToUser).toHaveBeenCalledTimes(1);
    await sync('RUNNING', 'user-1', 35, later(120));
    expect(fcmService.sendLiveUpdateToUser).toHaveBeenCalledTimes(2);
    expect(fcmService.sendLiveUpdateToUser).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({ remainingMinutes: '35' }),
    );
  });

  it('throttles corrections to one per minute', async () => {
    await sync('RUNNING', 'user-1', 20);
    await sync('RUNNING', 'user-1', 40, later(30));
    expect(fcmService.sendLiveUpdateToUser).toHaveBeenCalledTimes(1);
    await sync('RUNNING', 'user-1', 40, later(60));
    expect(fcmService.sendLiveUpdateToUser).toHaveBeenCalledTimes(2);
  });

  it('sends when the finish time becomes known or unknown', async () => {
    await sync('RUNNING', 'user-1', null);
    await sync('RUNNING', 'user-1', 20, later(60));
    expect(fcmService.sendLiveUpdateToUser).toHaveBeenCalledTimes(2);
  });

  it('sends again when the session owner changed', async () => {
    await sync('RUNNING', 'user-1');
    await sync('RUNNING', 'user-2');
    expect(fcmService.sendLiveUpdateToUser).toHaveBeenLastCalledWith(
      'user-2',
      expect.anything(),
    );
    expect(fcmService.sendLiveUpdateToUser).toHaveBeenCalledTimes(2);
  });

  it('sends nothing for sessions without an owner', async () => {
    await sync('RUNNING', null);
    expect(fcmService.sendLiveUpdateToUser).not.toHaveBeenCalled();
  });

  it('retries on the next sync when a device could not be reached', async () => {
    fcmService.sendLiveUpdateToUser.mockResolvedValueOnce({
      sent: 0,
      failed: 1,
    });
    await sync('RUNNING');
    await sync('RUNNING');
    expect(fcmService.sendLiveUpdateToUser).toHaveBeenCalledTimes(2);
  });

  it('sends END and forgets the session on end', async () => {
    await sync('RUNNING');
    await service.end('session-1', 'user-1', session, now);
    expect(fcmService.sendLiveUpdateToUser).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({
        state: 'END',
        remainingMinutes: '0',
        endsAt: String(Math.floor(now.getTime() / 1000)),
      }),
    );
    await sync('RUNNING');
    expect(fcmService.sendLiveUpdateToUser).toHaveBeenCalledTimes(3);
  });

  it('does not send an end message without a user', async () => {
    await service.end('session-1', null, session, now);
    expect(fcmService.sendLiveUpdateToUser).not.toHaveBeenCalled();
  });

  describe('tick', () => {
    const sent = () =>
      fcmService.sendLiveUpdateToUser.mock.calls as [
        string,
        Record<string, string>,
      ][];

    it('defaults to 3 minutes and reads LIVE_UPDATE_TICK_INTERVAL_SECONDS', () => {
      expect(service.tickIntervalMs).toBe(180_000);
      expect(create('300').tickIntervalMs).toBe(300_000);
      expect(create('0').tickIntervalMs).toBe(0);
      expect(create('10').tickIntervalMs).toBe(180_000);
      expect(create('abc').tickIntervalMs).toBe(180_000);
    });

    it('sends a tick every interval with the latest values', async () => {
      await sync('RUNNING', 'user-1', 20); // endsAt = now + 20m
      await service.tick(later(179));
      expect(sent()).toHaveLength(1);
      await service.tick(later(180));
      expect(sent()).toHaveLength(2);
      expect(sent()[1]).toEqual([
        'user-1',
        expect.objectContaining({
          type: 'LIVE_UPDATE',
          state: 'RUNNING',
          startedAt: String(Math.floor(session.startedAt!.getTime() / 1000)),
          endsAt: String(Math.floor(now.getTime() / 1000) + 1200),
          remainingMinutes: '17',
          updatedAt: String(Math.floor(later(180).getTime() / 1000)),
        }),
      ]);
      await service.tick(later(300));
      expect(sent()).toHaveLength(2);
      await service.tick(later(360));
      expect(sent()).toHaveLength(3);
    });

    it('uses the latest endsAt even when the drift was too small to send', async () => {
      await sync('RUNNING', 'user-1', 20);
      await sync('RUNNING', 'user-1', 20, later(60)); // finish moved +1m, not sent
      expect(sent()).toHaveLength(1);
      await service.tick(later(180));
      expect(sent()[1][1]).toEqual(
        expect.objectContaining({
          endsAt: String(Math.floor(later(60).getTime() / 1000) + 1200),
        }),
      );
    });

    it('restarts the timer after a transition', async () => {
      await sync('RUNNING', 'user-1', 20);
      await sync('COOLING', 'user-1', 10, later(150));
      expect(sent()).toHaveLength(2);
      await service.tick(later(180)); // 30s after the transition
      expect(sent()).toHaveLength(2);
      await service.tick(later(330));
      expect(sent()).toHaveLength(3);
      expect(sent()[2][1]).toEqual(
        expect.objectContaining({ state: 'COOLING' }),
      );
    });

    it('restarts the timer after a correction', async () => {
      await sync('RUNNING', 'user-1', 20);
      await sync('RUNNING', 'user-1', 40, later(120)); // correction
      expect(sent()).toHaveLength(2);
      await service.tick(later(180));
      expect(sent()).toHaveLength(2);
      await service.tick(later(300));
      expect(sent()).toHaveLength(3);
    });

    it('stops after end, unlink, END/ERROR and past endsAt', async () => {
      await sync('RUNNING');
      await service.end('session-1', 'user-1', session, later(10));
      fcmService.sendLiveUpdateToUser.mockClear();
      await service.tick(later(600));
      expect(sent()).toHaveLength(0);

      await sync('RUNNING');
      await service.end(null, 'user-1', session, later(10)); // unlink
      fcmService.sendLiveUpdateToUser.mockClear();
      await service.tick(later(600));
      expect(sent()).toHaveLength(0);

      await sync('RUNNING', 'user-1', 5);
      fcmService.sendLiveUpdateToUser.mockClear();
      await service.tick(later(400)); // endsAt (5m) passed: only the final message
      expect(sent()).toHaveLength(1);
      expect(sent()[0][1].remainingMinutes).toBe('0');
      fcmService.sendLiveUpdateToUser.mockClear();
      await service.tick(later(700));
      expect(sent()).toHaveLength(0);

      await sync('ERROR', 'user-1', 20, later(500));
      fcmService.sendLiveUpdateToUser.mockClear();
      await service.tick(later(900));
      expect(sent()).toHaveLength(0);
    });

    it('ticks only the new owner after an owner change', async () => {
      await sync('RUNNING', 'user-1');
      await sync('RUNNING', 'user-2', 20, later(10));
      fcmService.sendLiveUpdateToUser.mockClear();
      await service.tick(later(300));
      expect(sent()).toHaveLength(1);
      expect(sent()[0][0]).toBe('user-2');
    });

    it('does not restore the old owner when the send to the new owner fails', async () => {
      await sync('RUNNING', 'user-1');
      fcmService.sendLiveUpdateToUser.mockResolvedValueOnce({
        sent: 0,
        failed: 1,
      });
      await sync('RUNNING', 'user-2', 20, later(10));
      fcmService.sendLiveUpdateToUser.mockClear();
      await service.tick(later(300));
      expect(sent()).toHaveLength(1);
      expect(sent()[0][0]).toBe('user-2');
    });

    it('resends the transition to the new owner on the next sync after a failure', async () => {
      await sync('RUNNING', 'user-1');
      fcmService.sendLiveUpdateToUser.mockResolvedValueOnce({
        sent: 0,
        failed: 1,
      });
      await sync('RUNNING', 'user-2', 20, later(10));
      fcmService.sendLiveUpdateToUser.mockClear();
      await sync('RUNNING', 'user-2', 20, later(20));
      expect(sent()).toHaveLength(1);
      expect(sent()[0][0]).toBe('user-2');
    });

    it('does not tick without a known finish time', async () => {
      await sync('DETECTING', 'user-1', null);
      await service.tick(later(600));
      expect(sent()).toHaveLength(1);
    });

    describe('washers', () => {
      const washer = buildLiveUpdateSession(
        { uuid: 'machine-2', type: 'WASHER', location: 'A', index: 1 },
        null,
      );
      const syncWasher = (remainingMinutes: number | null, at: Date = now) =>
        service.syncRunning(
          'session-2',
          'user-1',
          washer,
          { state: 'RUNNING', remainingMinutes },
          at,
        );
      const washerFinals = () =>
        sent().filter(([, d]) => d.remainingMinutes === '0');

      it('never gets regular ticks', async () => {
        await syncWasher(20);
        await service.tick(later(600));
        expect(sent()).toHaveLength(1);
      });

      it('gets one final message once the entered endsAt passes', async () => {
        await syncWasher(20);
        await service.tick(later(1199));
        expect(washerFinals()).toHaveLength(0);
        await service.tick(later(1200));
        await service.tick(later(1500));
        expect(washerFinals()).toHaveLength(1);
        expect(washerFinals()[0][1]).toMatchObject({
          kind: 'WASHER',
          state: 'RUNNING',
          endsAt: String(Math.floor(later(1200).getTime() / 1000)),
        });
      });

      it('gets no final message without an entered time', async () => {
        await syncWasher(null);
        await service.tick(later(3600));
        expect(sent()).toHaveLength(1);
      });

      it('retries a failed first send on the tick and still sends the final', async () => {
        fcmService.sendLiveUpdateToUser.mockResolvedValueOnce({
          sent: 1,
          failed: 1,
        });
        await syncWasher(20);
        expect(sent()).toHaveLength(1);

        await service.tick(later(180));
        expect(sent()).toHaveLength(2); // retried, not dropped
        await service.tick(later(360));
        expect(sent()).toHaveLength(2); // delivered: no more retries

        await service.tick(later(1200));
        expect(washerFinals()).toHaveLength(1);
      });

      it('sends a user-entered change right away, even a small or recent one', async () => {
        await syncWasher(20);
        await service.tick(later(1201));
        expect(washerFinals()).toHaveLength(1);
        // 1 minute more, 1 second after the final: below the 2 minute drift and the 60 s spacing.
        await service.syncRunning(
          'session-2',
          'user-1',
          washer,
          { state: 'RUNNING', remainingMinutes: 1 },
          later(1202),
          { force: true },
        );
        expect(sent().at(-1)![1]).toMatchObject({ remainingMinutes: '1' });
        await service.tick(later(1202 + 60));
        expect(washerFinals()).toHaveLength(2);
      });

      it('gets another final message after the time is entered again', async () => {
        await syncWasher(20);
        await service.tick(later(1201));
        expect(washerFinals()).toHaveLength(1);
        await syncWasher(10, later(1210)); // now ends later(1810)
        await service.tick(later(1500));
        expect(washerFinals()).toHaveLength(1);
        await service.tick(later(1810));
        expect(washerFinals()).toHaveLength(2);
      });
    });

    it('stops when the owner has no Live Update device, resumes on next sync', async () => {
      await sync('RUNNING');
      fcmService.sendLiveUpdateToUser.mockResolvedValue({ sent: 0, failed: 0 });
      await service.tick(later(180));
      await service.tick(later(360));
      expect(sent()).toHaveLength(2); // initial + one tick, then dropped
      await sync('RUNNING', 'user-1', 20, later(400));
      expect(sent()).toHaveLength(3);
    });

    it('retries a failed tick at the next interval', async () => {
      await sync('RUNNING');
      fcmService.sendLiveUpdateToUser.mockResolvedValueOnce({
        sent: 0,
        failed: 1,
      });
      await service.tick(later(180));
      await service.tick(later(200));
      expect(sent()).toHaveLength(2);
      await service.tick(later(360));
      expect(sent()).toHaveLength(3);
    });

    describe('final message at endsAt', () => {
      // sync at `now` with 20 min left => endsAt = later(1200)
      const finals = () => sent().filter(([, d]) => d.remainingMinutes === '0');

      it('sends once right after endsAt, ignoring the tick interval', async () => {
        await sync('RUNNING');
        await service.tick(later(1199));
        expect(finals()).toHaveLength(0);
        await service.tick(later(1200));
        expect(finals()).toHaveLength(1);
        const [owner, data] = finals()[0];
        expect(owner).toBe('user-1');
        expect(data).toMatchObject({
          type: 'LIVE_UPDATE',
          state: 'RUNNING',
          endsAt: String(Math.floor(later(1200).getTime() / 1000)),
        });
      });

      it('sends only once per endsAt and then no ticks', async () => {
        await sync('COOLING');
        await service.tick(later(1205));
        const count = sent().length;
        await service.tick(later(1220));
        await service.tick(later(2000));
        expect(sent()).toHaveLength(count);
        expect(finals()).toHaveLength(1);
        expect(finals()[0][1].state).toBe('COOLING');
      });

      it('does not resend for a past endsAt re-synced with the same value', async () => {
        await sync('RUNNING');
        await service.tick(later(1201));
        await sync('RUNNING', 'user-1', 0, later(1260));
        await service.tick(later(1300));
        expect(finals()).toHaveLength(1);
      });

      it('re-arms when a sync extends endsAt', async () => {
        await sync('RUNNING');
        await service.tick(later(1201));
        expect(finals()).toHaveLength(1);
        await sync('RUNNING', 'user-1', 10, later(1210)); // now ends later(1810)
        await service.tick(later(1500));
        expect(finals()).toHaveLength(1); // not yet; regular ticks resume
        expect(sent().at(-1)![1].remainingMinutes).not.toBe('0');
        await service.tick(later(1810));
        expect(finals()).toHaveLength(2);
      });

      it('skips PAUSE and unknown finish time', async () => {
        await sync('PAUSE');
        await service.tick(later(1300));
        expect(finals()).toHaveLength(0);
        service = create();
        fcmService.sendLiveUpdateToUser.mockClear();
        await sync('DETECTING', 'user-1', null);
        await service.tick(later(1300));
        expect(sent()).toHaveLength(1);
      });

      it('skips sessions registered with an already past endsAt', async () => {
        await sync('RUNNING', 'user-1', 0);
        await service.tick(later(60));
        await service.tick(later(600));
        expect(sent()).toHaveLength(1);
      });

      it('retries a failed send at the tick interval, at most 3 times', async () => {
        await sync('RUNNING');
        fcmService.sendLiveUpdateToUser.mockResolvedValue({
          sent: 0,
          failed: 1,
        });
        await service.tick(later(1200));
        await service.tick(later(1250));
        expect(finals()).toHaveLength(1);
        await service.tick(later(1380));
        await service.tick(later(1560));
        await service.tick(later(1740));
        await service.tick(later(2000));
        expect(finals()).toHaveLength(3);
      });

      it('stops when the owner has no Live Update device', async () => {
        await sync('RUNNING');
        fcmService.sendLiveUpdateToUser.mockResolvedValue({
          sent: 0,
          failed: 0,
        });
        await service.tick(later(1200));
        await service.tick(later(1500));
        expect(finals()).toHaveLength(1);
      });
    });

    it('does nothing when ticks are disabled', async () => {
      service = create('0');
      await sync('RUNNING');
      await service.tick(later(600));
      expect(sent()).toHaveLength(1);
    });
  });
});
