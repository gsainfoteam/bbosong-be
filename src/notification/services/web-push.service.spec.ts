import { ConfigService } from '@nestjs/config';
import { NotificationRepository } from '@lib/database/repositories/notification.repository';
import * as webpush from 'web-push';
import { WebPushService } from './web-push.service';

jest.mock('@lib/database/repositories/notification.repository', () => ({}));
jest.mock('@lib/logger', () => ({ Loggable: () => () => undefined }));
jest.mock('web-push', () => ({
  sendNotification: jest.fn(),
  WebPushError: Error,
}));

describe('Web push activation timestamps', () => {
  const sendNotification = jest.mocked(webpush.sendNotification);
  const subscriptions = [
    {
      uuid: 'device-1',
      endpoint: 'https://push.example.com/1',
      p256dh: 'key',
      auth: 'secret',
    },
    {
      uuid: 'device-2',
      endpoint: 'https://push.example.com/2',
      p256dh: 'key',
      auth: 'secret',
    },
  ];
  const repository = {
    getUserPushSubscriptions: jest.fn(),
    markPushSubscriptionActivated: jest.fn(),
    unregisterPush: jest.fn(),
  };
  let service: WebPushService;
  const sentAt = new Date('2026-10-20T03:00:00Z');

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(sentAt);
    jest.clearAllMocks();
    repository.getUserPushSubscriptions.mockResolvedValue(subscriptions);
    repository.markPushSubscriptionActivated.mockResolvedValue({ count: 1 });
    repository.unregisterPush.mockResolvedValue({ count: 1 });
    sendNotification.mockResolvedValue({
      statusCode: 201,
      body: '',
      headers: {},
    });
    service = new WebPushService(
      new ConfigService(),
      repository as unknown as NotificationRepository,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('records successful sends for each device', async () => {
    await service.sendWebPushToUser('user', {
      title: 'Done',
      body: 'Laundry complete',
    });
    expect(repository.markPushSubscriptionActivated.mock.calls).toEqual([
      ['device-1', sentAt],
      ['device-2', sentAt],
    ]);
    expect(repository.unregisterPush).not.toHaveBeenCalled();
  });

  it('does not activate a failed device while recording another successful device', async () => {
    sendNotification.mockRejectedValueOnce(
      Object.assign(new Error('Unavailable'), { statusCode: 503 }),
    );
    await service.sendWebPushToUser('user', {
      title: 'Done',
      body: 'Laundry complete',
    });
    expect(repository.markPushSubscriptionActivated).toHaveBeenCalledTimes(1);
    expect(repository.markPushSubscriptionActivated).toHaveBeenCalledWith(
      'device-2',
      sentAt,
    );
    expect(repository.unregisterPush).not.toHaveBeenCalled();
  });

  it('removes expired subscriptions without recording an activation', async () => {
    sendNotification.mockRejectedValueOnce(
      Object.assign(new Error('Gone'), { statusCode: 410 }),
    );
    await service.sendWebPushToUser('user', {
      title: 'Done',
      body: 'Laundry complete',
    });
    expect(repository.unregisterPush).toHaveBeenCalledWith(
      'user',
      subscriptions[0].endpoint,
    );
    expect(repository.markPushSubscriptionActivated).toHaveBeenCalledTimes(1);
    expect(repository.markPushSubscriptionActivated).toHaveBeenCalledWith(
      'device-2',
      sentAt,
    );
  });

  it('does not turn a timestamp persistence failure into a send failure or delete the device', async () => {
    repository.markPushSubscriptionActivated.mockRejectedValueOnce(
      new Error('Database unavailable'),
    );
    await expect(
      service.sendWebPushToUser('user', {
        title: 'Done',
        body: 'Laundry complete',
      }),
    ).resolves.toBeUndefined();
    expect(repository.markPushSubscriptionActivated).toHaveBeenCalledTimes(2);
    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(repository.unregisterPush).not.toHaveBeenCalled();
  });
});
