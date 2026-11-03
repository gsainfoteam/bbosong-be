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
    {} as never,
  );
  await service.notifyMachineOffline({
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
  });
});

it('sends dryer error alerts over the same web-push channel as completion', async () => {
  const sendWebPushToUser = jest.fn().mockResolvedValue(undefined);
  const service = new NotificationService(
    {} as never,
    {
      sendWebPushToUser,
    } as never,
    {} as never,
  );
  await service.notifyMachineError('user-1', {
    location: Location.A,
    type: MachineType.DRYER,
    index: 3,
  } as Machine);
  expect(sendWebPushToUser).toHaveBeenCalledWith('user-1', {
    title: '건조기 오류 알림 🧺',
    body: 'A동 3번 건조기에 오류가 발생했습니다. 기기를 확인해 주세요.',
    url: '/',
  });
});

describe('laundry room availability subscription', () => {
  const room = [Location.A, Gender.MALE, MachineType.WASHER] as const;
  const notificationRepository = {
    createLaundryRoomSubscription: jest.fn(),
    deleteLaundryRoomSubscriptionsByUuids: jest.fn(),
    getLaundryRoomSubscribers: jest.fn(),
  };
  const webPushService = { sendWebPushToUser: jest.fn() };
  const machineRepository = { countAvailableMachines: jest.fn() };
  let service: NotificationService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new NotificationService(
      notificationRepository as never,
      webPushService as never,
      machineRepository as never,
    );
    notificationRepository.createLaundryRoomSubscription.mockResolvedValue({
      uuid: 'sub-1',
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
      notificationRepository.deleteLaundryRoomSubscriptionsByUuids,
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
      notificationRepository.deleteLaundryRoomSubscriptionsByUuids,
    ).toHaveBeenCalledWith(['sub-1']);
  });

  it('skips notification when no machine is actually available', async () => {
    notificationRepository.getLaundryRoomSubscribers.mockResolvedValue([
      { uuid: 'sub-1', userUuid: 'user-1' },
    ]);
    machineRepository.countAvailableMachines.mockResolvedValue(0);
    await service.notifyLaundryRoomAvailable(...room);
    expect(webPushService.sendWebPushToUser).not.toHaveBeenCalled();
    expect(
      notificationRepository.deleteLaundryRoomSubscriptionsByUuids,
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
      .mockResolvedValueOnce(undefined);
    await service.notifyLaundryRoomAvailable(...room);
    expect(webPushService.sendWebPushToUser).toHaveBeenCalledTimes(2);
    expect(
      notificationRepository.deleteLaundryRoomSubscriptionsByUuids,
    ).toHaveBeenCalledWith(['sub-2']);
  });
});
