import { INestApplication, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport';
import request from 'supertest';
import { App } from 'supertest/types';
import { Gender, Role } from 'generated/prisma/client';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GetUsersResDto } from './dto/res/get-users-res.dto';

jest.mock('@lib/infoteam-account', () => ({}));
jest.mock('@lib/database', () => ({}));
jest.mock('@lib/audit-log', () => ({}));
jest.mock('../notification/notification.service', () => ({}));
jest.mock(
  '@gsainfoteam/nest-observability',
  () => ({ Trace: () => () => undefined }),
  { virtual: true },
);

@Injectable()
class TestUserStrategy extends PassportStrategy(Strategy, 'user') {
  authenticate(req: Request) {
    const authorization = req.headers.authorization;
    if (!authorization) {
      this.fail();
      return;
    }
    this.success({
      uuid: '11111111-1111-4111-8111-111111111111',
      role: authorization === 'Bearer admin' ? Role.ADMIN : Role.USER,
    });
  }

  validate() {
    return null;
  }
}

describe('GET /auth/users', () => {
  let app: INestApplication<App>;
  const findUsersWithPushSubscriptions = jest.fn();
  const createdAt = new Date('2026-10-01T00:00:00Z');
  const lastActivatedAt = new Date('2026-10-20T00:00:00Z');
  const users: GetUsersResDto[] = [
    {
      uuid: '11111111-1111-4111-8111-111111111111',
      name: 'Test User',
      email: 'test@example.com',
      studentNumber: '20260001',
      gender: Gender.MALE,
      role: Role.USER,
      pushSubscriptions: [
        {
          uuid: 'device-1',
          userAgent: 'Browser A',
          createdAt,
          lastActivatedAt,
        },
        { uuid: 'device-2', userAgent: null, createdAt, lastActivatedAt: null },
      ],
    },
    {
      uuid: '22222222-2222-4222-8222-222222222222',
      name: 'No Push User',
      email: 'no-push@example.com',
      studentNumber: '20260002',
      gender: Gender.FEMALE,
      role: Role.USER,
      pushSubscriptions: [],
    },
  ];

  beforeAll(async () => {
    const args = [
      {},
      {},
      new ConfigService({
        USER_JWT_SECRET: 'test',
        USER_JWT_EXPIRE: '15m',
        USER_JWT_AUDIENCE: 'test',
        USER_JWT_ISSUER: 'test',
        USER_REFRESH_TOKEN_EXPIRE: '7d',
        REFRESH_TOKEN_HMAC_SECRET: 'test',
        POLICY_API_URL: 'https://example.com/policy',
        SERVICE_NAME_FOR_POLICY_VERSION: 'test',
      }),
      {},
      {},
      { findUsersWithPushSubscriptions },
      {},
      {},
      {},
      {},
    ] as unknown as ConstructorParameters<typeof AuthService>;
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: new AuthService(...args) },
        TestUserStrategy,
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    findUsersWithPushSubscriptions.mockReset().mockResolvedValue(users);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests before querying users', async () => {
    await request(app.getHttpServer()).get('/auth/users').expect(401);
    expect(findUsersWithPushSubscriptions).not.toHaveBeenCalled();
  });

  it('rejects regular users before querying users', async () => {
    await request(app.getHttpServer())
      .get('/auth/users')
      .set('Authorization', 'Bearer user')
      .expect(403);
    expect(findUsersWithPushSubscriptions).not.toHaveBeenCalled();
  });

  it('returns all device subscriptions, ISO timestamps, and users without devices to admins', async () => {
    await request(app.getHttpServer())
      .get('/auth/users')
      .set('Authorization', 'Bearer admin')
      .expect(200)
      .expect(
        users.map((user) => ({
          ...user,
          pushSubscriptions: user.pushSubscriptions.map((subscription) => ({
            ...subscription,
            createdAt: subscription.createdAt.toISOString(),
            lastActivatedAt:
              subscription.lastActivatedAt?.toISOString() ?? null,
          })),
        })),
      );
    expect(findUsersWithPushSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('returns an empty array when there are no users', async () => {
    findUsersWithPushSubscriptions.mockResolvedValue([]);
    await request(app.getHttpServer())
      .get('/auth/users')
      .set('Authorization', 'Bearer admin')
      .expect(200)
      .expect([]);
  });
});
