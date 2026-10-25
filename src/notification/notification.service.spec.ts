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
  const service = new NotificationService(repository, {
    sendWebPushToUser,
  } as never);
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
