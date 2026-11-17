import { NotificationService } from './notification.service';
import { NotificationRepository } from '@lib/database/repositories/notification.repository';
import {
  Gender,
  Location,
  Machine,
  MachineType,
  Role,
} from 'generated/prisma/client';

jest.mock('@gsainfoteam/nest-observability', () => ({
  Trace: () => (target: unknown) => target,
}));
jest.mock('@lib/logger', () => ({
  Loggable: () => (target: unknown) => target,
}));
jest.mock('@lib/database/database.service', () => ({}));
jest.mock('./services/web-push.service', () => ({}));
jest.mock('./services/fcm.service', () => ({}));
jest.mock('generated/prisma/client', () =>
  jest.requireActual<typeof import('../../generated/prisma/enums')>(
    '../../generated/prisma/enums',
  ),
);

it('sends offline alerts only to active administrators with existing push subscriptions', async () => {
  const findMany = jest.fn().mockResolvedValue([{ uuid: 'admin-1' }]);
  const repository = new NotificationRepository({
    user: { findMany },
  } as never);
  const sendWebPushToUser = jest.fn().mockResolvedValue(undefined);
  const service = new NotificationService(
    repository,
    { sendWebPushToUser } as never,
    { sendFcmToUser: jest.fn().mockResolvedValue(false) } as never,
    {} as never,
  );
  await service.notifyMachineOffline({
    uuid: 'machine-1',
    location: Location.B,
    gender: Gender.FEMALE,
    type: MachineType.DRYER,
    index: 2,
  } as Machine);
  expect(findMany).toHaveBeenCalledWith({
    where: {
      deletedAt: null,
      role: Role.ADMIN,
      pushSubscriptions: { some: {} },
    },
    select: { uuid: true },
  });
  expect(sendWebPushToUser).toHaveBeenCalledTimes(1);
  expect(sendWebPushToUser).toHaveBeenCalledWith('admin-1', {
    title: '기기 연결 끊김 알림',
    body: 'B동 여성 세탁실 2번 건조기의 연결이 끊겼습니다. 기기와 네트워크를 확인해 주세요.',
    url: '/admin/machines',
    data: { type: 'machine-offline', machineUuid: 'machine-1' },
  });
});

it('sends dryer error alerts over the same web-push channel as completion', async () => {
  const sendWebPushToUser = jest.fn().mockResolvedValue(undefined);
  const service = new NotificationService(
    {} as never,
    {
      sendWebPushToUser,
    } as never,
    { sendFcmToUser: jest.fn().mockResolvedValue(false) } as never,
    {} as never,
  );
  await service.notifyMachineError('user-1', {
    uuid: 'machine-3',
    location: Location.A,
    type: MachineType.DRYER,
    index: 3,
  } as Machine);
  expect(sendWebPushToUser).toHaveBeenCalledWith('user-1', {
    title: '건조기 오류 알림 🧺',
    body: 'A동 3번 건조기에 오류가 발생했습니다. 기기를 확인해 주세요.',
    url: '/',
    data: { type: 'machine-error', machineUuid: 'machine-3' },
  });
});

describe('laundry room availability subscription', () => {
  const room = [Location.A, Gender.MALE, MachineType.WASHER] as const;
  const notificationRepository = {
    createLaundryRoomSubscription: jest.fn(),
    rollbackLaundryRoomSubscription: jest.fn(),
    getLaundryRoomSubscribers: jest.fn(),
    completeLaundryRoomNotifications: jest.fn(),
  };
  const webPushService = { sendWebPushToUser: jest.fn() };
  const fcmService = { sendFcmToUser: jest.fn() };
  const machineRepository = { countAvailableMachines: jest.fn() };
  let service: NotificationService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new NotificationService(
      notificationRepository as never,
      webPushService as never,
      fcmService as never,
      machineRepository as never,
    );
    notificationRepository.createLaundryRoomSubscription.mockResolvedValue({
      subscription: { uuid: 'sub-1' },
      logUuid: 'log-1',
    });
  });

  it('rejects with 409 when a machine is already available', async () => {
    machineRepository.countAvailableMachines.mockResolvedValue(1);
    await expect(
      service.createLaundryRoomSubscription('user-1', ...room),
    ).rejects.toMatchObject({
      status: 409,
      response: { errorCode: 'LAUNDRY_ROOM_ALREADY_AVAILABLE' },
    });
    expect(
      notificationRepository.createLaundryRoomSubscription,
    ).not.toHaveBeenCalled();
  });

  it('subscribes when no machine is available', async () => {
    machineRepository.countAvailableMachines.mockResolvedValue(0);
    await expect(
      service.createLaundryRoomSubscription('user-1', ...room),
    ).resolves.toEqual({ uuid: 'sub-1' });
    expect(machineRepository.countAvailableMachines).toHaveBeenCalledWith(
      ...room,
    );
    expect(
      notificationRepository.rollbackLaundryRoomSubscription,
    ).not.toHaveBeenCalled();
  });

  it('rolls back the subscription when a machine frees up during insert', async () => {
    machineRepository.countAvailableMachines
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    await expect(
      service.createLaundryRoomSubscription('user-1', ...room),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      notificationRepository.rollbackLaundryRoomSubscription,
    ).toHaveBeenCalledWith('sub-1', 'log-1');
  });

  it('skips notification when no machine is actually available', async () => {
    notificationRepository.getLaundryRoomSubscribers.mockResolvedValue([
      { uuid: 'sub-1', userUuid: 'user-1' },
    ]);
    machineRepository.countAvailableMachines.mockResolvedValue(0);
    await service.notifyLaundryRoomAvailable(...room);
    expect(webPushService.sendWebPushToUser).not.toHaveBeenCalled();
    expect(
      notificationRepository.completeLaundryRoomNotifications,
    ).not.toHaveBeenCalled();
  });

  it('keeps subscriptions whose push failed for the next event', async () => {
    notificationRepository.getLaundryRoomSubscribers.mockResolvedValue([
      { uuid: 'sub-1', userUuid: 'user-1' },
      { uuid: 'sub-2', userUuid: 'user-2' },
    ]);
    machineRepository.countAvailableMachines.mockResolvedValue(1);
    webPushService.sendWebPushToUser
      .mockRejectedValueOnce(new Error('push failed'))
      .mockResolvedValueOnce(true);
    await service.notifyLaundryRoomAvailable(...room);
    expect(webPushService.sendWebPushToUser).toHaveBeenCalledTimes(2);
    expect(
      notificationRepository.completeLaundryRoomNotifications,
    ).toHaveBeenCalledWith([
      {
        uuid: 'sub-2',
        userUuid: 'user-2',
        notifiedAt: expect.any(Date) as Date,
      },
    ]);
  });

  it('keeps subscriptions when no device accepted the push', async () => {
    notificationRepository.getLaundryRoomSubscribers.mockResolvedValue([
      { uuid: 'sub-1', userUuid: 'user-1' },
      { uuid: 'sub-2', userUuid: 'user-2' },
    ]);
    machineRepository.countAvailableMachines.mockResolvedValue(1);
    webPushService.sendWebPushToUser
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    await service.notifyLaundryRoomAvailable(...room);
    expect(
      notificationRepository.completeLaundryRoomNotifications,
    ).toHaveBeenCalledWith([
      {
        uuid: 'sub-2',
        userUuid: 'user-2',
        notifiedAt: expect.any(Date) as Date,
      },
    ]);
  });

  it('records each push completion time separately', async () => {
    jest.useFakeTimers();
    try {
      notificationRepository.getLaundryRoomSubscribers.mockResolvedValue([
        { uuid: 'sub-1', userUuid: 'user-1' },
        { uuid: 'sub-2', userUuid: 'user-2' },
      ]);
      machineRepository.countAvailableMachines.mockResolvedValue(1);
      jest.setSystemTime(new Date('2026-11-15T14:59:59Z'));
      webPushService.sendWebPushToUser
        .mockResolvedValueOnce(true)
        .mockImplementationOnce(async () => {
          // Let the first send's continuation run before the clock moves.
          for (let i = 0; i < 10; i++) await Promise.resolve();
          jest.setSystemTime(new Date('2026-11-15T15:00:01Z'));
          return true;
        });
      await service.notifyLaundryRoomAvailable(...room);
      const [notified] = notificationRepository.completeLaundryRoomNotifications
        .mock.calls[0] as [{ notifiedAt: Date }[]];
      expect(notified.map((n) => n.notifiedAt.toISOString())).toEqual([
        '2026-11-15T14:59:59.000Z',
        '2026-11-15T15:00:01.000Z',
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('logs and removes subscriptions through the repository after a successful push', async () => {
    const subscription = {
      uuid: 'sub-1',
      userUuid: 'user-1',
      location: Location.A,
      gender: Gender.MALE,
      type: MachineType.WASHER,
      createdAt: new Date('2026-11-14T00:00:00Z'),
    };
    notificationRepository.getLaundryRoomSubscribers.mockResolvedValue([
      subscription,
    ]);
    machineRepository.countAvailableMachines.mockResolvedValue(1);
    webPushService.sendWebPushToUser.mockResolvedValue(true);
    await service.notifyLaundryRoomAvailable(...room);
    expect(
      notificationRepository.completeLaundryRoomNotifications,
    ).toHaveBeenCalledWith([
      { ...subscription, notifiedAt: expect.any(Date) as Date },
    ]);
  });
});

it('writes a notification log row and deletes the subscription in one transaction', async () => {
  const createMany = jest.fn().mockReturnValue('create');
  const deleteMany = jest.fn().mockReturnValue('delete');
  const $transaction = jest.fn().mockResolvedValue([]);
  const repository = new NotificationRepository({
    laundryRoomNotificationLog: { createMany },
    laundryRoomSubscription: { deleteMany },
    $transaction,
  } as never);
  const createdAt = new Date('2026-11-14T00:00:00Z');
  const notifiedAt = new Date('2026-11-15T00:00:00Z');
  await repository.completeLaundryRoomNotifications([
    {
      uuid: 'sub-1',
      userUuid: 'user-1',
      location: Location.A,
      gender: Gender.MALE,
      type: MachineType.WASHER,
      createdAt,
      notifiedAt,
    },
  ]);
  expect(createMany).toHaveBeenCalledWith({
    data: [
      {
        userUuid: 'user-1',
        location: Location.A,
        gender: Gender.MALE,
        type: MachineType.WASHER,
        subscribedAt: createdAt,
        notifiedAt,
      },
    ],
  });
  expect(deleteMany).toHaveBeenCalledWith({
    where: { uuid: { in: ['sub-1'] } },
  });
  expect($transaction).toHaveBeenCalledWith(['create', 'delete']);
});

describe('daily laundry room notification stats', () => {
  const countDaily = jest.fn().mockResolvedValue([]);
  const service = new NotificationService(
    { countDailyLaundryRoomStats: countDaily } as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('rejects from after to', async () => {
    await expect(
      service.getDailyLaundryRoomNotificationStats('2026-11-15', '2026-11-14'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects ranges over 90 days and accepts exactly 90', async () => {
    await expect(
      service.getDailyLaundryRoomNotificationStats('2026-01-01', '2026-04-01'),
    ).rejects.toMatchObject({ status: 400 });
    await service.getDailyLaundryRoomNotificationStats(
      '2026-01-01',
      '2026-03-31',
    );
    expect(countDaily).toHaveBeenCalledWith('2026-01-01', '2026-03-31');
  });
});

it('writes the subscription and its log row in one transaction with an explicit UTC time', async () => {
  const upsert = jest.fn().mockReturnValue('upsert');
  const create = jest.fn().mockReturnValue('log');
  const $transaction = jest
    .fn()
    .mockResolvedValue([{ uuid: 'sub-1' }, { uuid: 'log-1' }]);
  const repository = new NotificationRepository({
    laundryRoomSubscription: { upsert },
    laundryRoomSubscriptionLog: { create },
    $transaction,
  } as never);
  await expect(
    repository.createLaundryRoomSubscription(
      'user-1',
      Location.A,
      Gender.MALE,
      MachineType.WASHER,
    ),
  ).resolves.toEqual({ subscription: { uuid: 'sub-1' }, logUuid: 'log-1' });
  expect($transaction).toHaveBeenCalledWith(['upsert', 'log']);
  const { subscribedAt } = (
    create.mock.calls[0] as [{ data: { subscribedAt: Date } }]
  )[0].data;
  expect(subscribedAt).toBeInstanceOf(Date);
});

describe('push fan-out and device registration', () => {
  const machine = {
    uuid: 'machine-1',
    location: Location.A,
    gender: Gender.MALE,
    type: MachineType.WASHER,
    index: 1,
  } as Machine;
  const repository = {
    registerNativePush: jest.fn(),
    unregisterNativePush: jest.fn(),
  };
  const webPushService = { sendWebPushToUser: jest.fn() };
  const fcmService = { sendFcmToUser: jest.fn() };
  let service: NotificationService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new NotificationService(
      repository as never,
      webPushService as never,
      fcmService as never,
      {} as never,
    );
  });

  it('sends the same payload over Web Push and FCM', async () => {
    webPushService.sendWebPushToUser.mockResolvedValue(true);
    fcmService.sendFcmToUser.mockResolvedValue(true);
    await service.notifyMachineCompletion('user-1', machine);
    const payload = {
      title: '세탁기 완료 알림 🧺',
      body: 'A동 1번 세탁기 작동이 완료되었습니다. 빨래를 수거해 주세요!',
      url: '/',
      data: { type: 'machine-completion', machineUuid: 'machine-1' },
    };
    expect(webPushService.sendWebPushToUser).toHaveBeenCalledWith(
      'user-1',
      payload,
    );
    expect(fcmService.sendFcmToUser).toHaveBeenCalledWith('user-1', payload);
  });

  it('still reaches FCM when Web Push throws, and vice versa', async () => {
    webPushService.sendWebPushToUser.mockRejectedValue(new Error('db'));
    fcmService.sendFcmToUser.mockResolvedValue(true);
    await expect(
      service.notifyMachineCompletion('user-1', machine),
    ).resolves.toBeUndefined();

    webPushService.sendWebPushToUser.mockResolvedValue(true);
    fcmService.sendFcmToUser.mockRejectedValue(new Error('fcm'));
    await expect(
      service.notifyMachineCompletion('user-1', machine),
    ).resolves.toBeUndefined();
  });

  it('propagates a channel failure when nothing was delivered', async () => {
    webPushService.sendWebPushToUser.mockResolvedValue(false);
    fcmService.sendFcmToUser.mockRejectedValue(new Error('fcm'));
    await expect(
      service.notifyMachineCompletion('user-1', machine),
    ).rejects.toThrow('fcm');
  });

  it('identifies the laundry-room subscription in the data payload and counts an FCM-only delivery', async () => {
    const getSubscribers = jest.fn().mockResolvedValue([
      {
        uuid: 'sub-1',
        userUuid: 'user-1',
        location: Location.A,
        gender: Gender.MALE,
        type: MachineType.WASHER,
        createdAt: new Date(),
      },
    ]);
    const complete = jest.fn();
    const svc = new NotificationService(
      {
        getLaundryRoomSubscribers: getSubscribers,
        completeLaundryRoomNotifications: complete,
      } as never,
      webPushService as never,
      fcmService as never,
      { countAvailableMachines: jest.fn().mockResolvedValue(1) } as never,
    );
    webPushService.sendWebPushToUser.mockResolvedValue(false);
    fcmService.sendFcmToUser.mockResolvedValue(true);
    await svc.notifyLaundryRoomAvailable(
      Location.A,
      Gender.MALE,
      MachineType.WASHER,
    );
    expect(fcmService.sendFcmToUser).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        data: {
          type: 'laundry-room-available',
          location: 'A',
          gender: 'MALE',
          machineType: 'WASHER',
        },
      }),
    );
    expect(complete).toHaveBeenCalledWith([
      expect.objectContaining({ uuid: 'sub-1' }),
    ]);
  });

  it('registers and unregisters native tokens through the repository', async () => {
    await service.registerNativePush(
      'user-1',
      { platform: 'IOS', token: 'tok' },
      'UA',
    );
    expect(repository.registerNativePush).toHaveBeenCalledWith(
      'user-1',
      'IOS',
      'tok',
      'UA',
    );
    await service.unregisterNativePush('user-1', 'tok');
    expect(repository.unregisterNativePush).toHaveBeenCalledWith(
      'user-1',
      'tok',
    );
  });
});
