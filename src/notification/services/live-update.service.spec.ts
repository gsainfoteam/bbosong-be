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

  beforeEach(() => {
    jest.resetAllMocks();
    fcmService.sendLiveUpdateToUser.mockResolvedValue({ sent: 1, failed: 0 });
    service = new LiveUpdateService(fcmService as never);
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
});
