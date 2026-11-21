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

  const sync = (state: string, owner: string | null = 'user-1') =>
    service.syncRunning(
      'session-1',
      owner,
      session,
      { state, remainingMinutes: 20 },
      now,
    );

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
