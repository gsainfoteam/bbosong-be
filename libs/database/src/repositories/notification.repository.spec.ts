import { NotificationRepository } from './notification.repository';

jest.mock('@gsainfoteam/nest-observability', () => ({
  Trace: () => (target: unknown) => target,
}));
jest.mock('@lib/logger', () => ({
  Loggable: () => (target: unknown) => target,
}));
jest.mock('@lib/database/database.service', () => ({}));
jest.mock('generated/prisma/client', () => ({
  ...jest.requireActual<typeof import('../../../../generated/prisma/enums')>(
    '../../../../generated/prisma/enums',
  ),
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
}));

describe('NotificationRepository native push devices', () => {
  const upsert = jest.fn<Promise<unknown>, [unknown]>().mockResolvedValue({});
  const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const findMany = jest.fn().mockResolvedValue([]);
  const repository = new NotificationRepository({
    userPushSubscription: { upsert, deleteMany, findMany },
  } as never);

  beforeEach(() => jest.clearAllMocks());

  it('upserts by token and moves ownership to the new account', async () => {
    await repository.registerNativePush('user-2', 'ANDROID', 'tok', 'UA');
    expect(upsert).toHaveBeenCalledWith({
      where: { fcmToken: 'tok' },
      create: {
        userUuid: 'user-2',
        platform: 'ANDROID',
        fcmToken: 'tok',
        userAgent: 'UA',
      },
      update: { userUuid: 'user-2', platform: 'ANDROID', userAgent: 'UA' },
    });
  });

  it('only deletes the token for the owning user', async () => {
    await repository.unregisterNativePush('user-1', 'tok');
    expect(deleteMany).toHaveBeenCalledWith({
      where: { fcmToken: 'tok', userUuid: 'user-1' },
    });
  });

  it('keeps Web Push and native lookups separate', async () => {
    await repository.getUserWebPushSubscriptions('user-1');
    expect(findMany).toHaveBeenLastCalledWith({
      where: { userUuid: 'user-1', platform: 'WEB' },
    });
    await repository.getUserNativePushDevices('user-1');
    expect(findMany).toHaveBeenLastCalledWith({
      where: { userUuid: 'user-1', platform: { in: ['IOS', 'ANDROID'] } },
    });
  });

  it('registers Web Push subscriptions as WEB', async () => {
    await repository.registerPush('user-1', 'https://ep', 'k', 'a', 'UA');
    expect(upsert).toHaveBeenCalledWith({
      where: { endpoint: 'https://ep' },
      create: {
        userUuid: 'user-1',
        platform: 'WEB',
        endpoint: 'https://ep',
        p256dh: 'k',
        auth: 'a',
        userAgent: 'UA',
      },
      update: { userUuid: 'user-1', p256dh: 'k', auth: 'a', userAgent: 'UA' },
    });
  });
});
