import { ConfigService } from '@nestjs/config';
import { NotificationRepository } from '@lib/database/repositories/notification.repository';
import { Message } from 'firebase-admin/messaging';
import { FcmService } from './fcm.service';

const send = jest.fn();
jest.mock('@lib/database/repositories/notification.repository', () => ({}));
jest.mock('@lib/logger', () => ({ Loggable: () => () => undefined }));
jest.mock('firebase-admin/app', () => ({
  cert: jest.fn((credential: unknown) => credential),
  getApps: jest.fn(() => []),
  initializeApp: jest.fn(() => ({ name: 'bbosong-fcm' })),
}));
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({ send })),
}));

const fcmError = (code: string, message = 'boom') =>
  Object.assign(new Error(message), { code });

const sentMessage = (index: number) =>
  (send.mock.calls as [Message][])[index][0];

describe('FcmService', () => {
  const sentAt = new Date('2026-11-18T03:00:00Z');
  const devices = [
    { uuid: 'device-1', fcmToken: 'token-1-aaaaaaaaaaaa' },
    { uuid: 'device-2', fcmToken: 'token-2-bbbbbbbbbbbb' },
  ];
  const repository = {
    getUserNativePushDevices: jest.fn(),
    markPushSubscriptionActivated: jest.fn(),
    unregisterNativePush: jest.fn(),
  };
  const payload = {
    title: 'Done',
    body: 'Laundry complete',
    url: '/',
    icon: '/icon.png',
    data: { type: 'laundry-room-available', count: 2, nested: { a: 1 } },
  };
  const credentials = JSON.stringify({
    project_id: 'p',
    client_email: 'e',
    private_key: 'k',
  });

  const create = (env: Record<string, string> = {}) => {
    const service = new FcmService(
      new ConfigService({ FIREBASE_SERVICE_ACCOUNT_JSON: credentials, ...env }),
      repository as unknown as NotificationRepository,
    );
    service.onModuleInit();
    return service;
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(sentAt);
    jest.clearAllMocks();
    repository.getUserNativePushDevices.mockResolvedValue(devices);
    repository.markPushSubscriptionActivated.mockResolvedValue({ count: 1 });
    repository.unregisterNativePush.mockResolvedValue({ count: 1 });
    send.mockResolvedValue('projects/p/messages/1');
  });

  afterEach(() => jest.useRealTimers());

  it('sends notification plus string-only data to every device and records activation', async () => {
    await expect(create().sendFcmToUser('user', payload)).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(sentMessage(0)).toMatchObject({
      token: 'token-1-aaaaaaaaaaaa',
      notification: { title: 'Done', body: 'Laundry complete' },
      data: {
        type: 'laundry-room-available',
        count: '2',
        nested: '{"a":1}',
        url: '/',
        icon: '/icon.png',
      },
      android: {
        priority: 'high',
        notification: { channelId: 'default', sound: 'default' },
      },
      apns: { payload: { aps: { sound: 'default' } } },
    });
    expect(repository.markPushSubscriptionActivated.mock.calls).toEqual([
      ['device-1', sentAt],
      ['device-2', sentAt],
    ]);
  });

  it('uses the configured Android channel and accepts base64 credentials', async () => {
    await create({
      FIREBASE_SERVICE_ACCOUNT_JSON:
        Buffer.from(credentials).toString('base64'),
      FCM_ANDROID_CHANNEL_ID: 'laundry',
    }).sendFcmToUser('user', payload);
    expect(sentMessage(0).android?.notification?.channelId).toBe('laundry');
  });

  it.each([
    ['messaging/registration-token-not-registered', 'x'],
    ['messaging/invalid-registration-token', 'x'],
    [
      'messaging/invalid-argument',
      'The registration token is not a valid FCM registration token',
    ],
  ])('removes the device on %s', async (code, message) => {
    send.mockRejectedValueOnce(fcmError(code, message));
    await expect(create().sendFcmToUser('user', payload)).resolves.toBe(true);
    expect(repository.unregisterNativePush).toHaveBeenCalledTimes(1);
    expect(repository.unregisterNativePush).toHaveBeenCalledWith(
      'user',
      'token-1-aaaaaaaaaaaa',
    );
    expect(repository.markPushSubscriptionActivated).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['messaging/invalid-argument', 'Invalid JSON payload received.'],
    ['messaging/server-unavailable', 'unavailable'],
    ['messaging/mismatched-credential', 'sender id mismatch'],
  ])('keeps the device on transient or non-token error %s', async (code, m) => {
    send.mockRejectedValue(fcmError(code, m));
    await expect(create().sendFcmToUser('user', payload)).resolves.toBe(false);
    expect(repository.unregisterNativePush).not.toHaveBeenCalled();
  });

  it('does not turn an activation write failure into a send failure', async () => {
    repository.markPushSubscriptionActivated.mockRejectedValue(new Error('db'));
    await expect(create().sendFcmToUser('user', payload)).resolves.toBe(true);
    expect(repository.unregisterNativePush).not.toHaveBeenCalled();
  });

  it('reports no delivery without devices', async () => {
    repository.getUserNativePushDevices.mockResolvedValue([]);
    await expect(create().sendFcmToUser('user', payload)).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('is a no-op without credentials and rejects malformed credentials', async () => {
    const service = new FcmService(
      new ConfigService({}),
      repository as unknown as NotificationRepository,
    );
    service.onModuleInit();
    await expect(service.sendFcmToUser('user', payload)).resolves.toBe(false);
    expect(repository.getUserNativePushDevices).not.toHaveBeenCalled();

    const bad = new FcmService(
      new ConfigService({ FIREBASE_SERVICE_ACCOUNT_JSON: '{not json' }),
      repository as unknown as NotificationRepository,
    );
    expect(() => bad.onModuleInit()).toThrow(
      'FIREBASE_SERVICE_ACCOUNT_JSON must be',
    );
  });
});
