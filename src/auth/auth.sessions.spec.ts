import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { Response } from 'express';
import { Gender, Role, User } from 'generated/prisma/client';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UserStrategy } from './guard/user.strategy';
import { UserRefreshTokenRepository } from '../../libs/database/src/repositories/user-refresh-token.repository';

jest.mock('@lib/infoteam-account', () => ({}));
jest.mock('@lib/database', () => ({}));
jest.mock('@lib/audit-log', () => ({}));
jest.mock('../notification/notification.service', () => ({}));
jest.mock('../../libs/database/src/database.service', () => ({}));
jest.mock('@lib/logger', () => ({ Loggable: () => () => undefined }));
jest.mock(
  '@gsainfoteam/nest-observability',
  () => ({ Trace: () => () => undefined }),
  { virtual: true },
);

describe('Independent user sessions', () => {
  const user: User = {
    uuid: '11111111-1111-4111-8111-111111111111',
    studentNumber: '20260001',
    name: 'Test User',
    email: 'test@example.com',
    gender: Gender.MALE,
    role: Role.USER,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function setup() {
    const sessions = new Map<
      string,
      { userUuid: string; sessionId: string; expiredAt: Date }
    >();
    const saveToken = (
      userUuid: string,
      token: string,
      sessionId: string,
      expiredAt: Date,
    ) => {
      sessions.set(token, { userUuid, sessionId, expiredAt });
      return Promise.resolve();
    };
    const deleteAll = jest.fn((userUuid: string) => {
      for (const [token, session] of sessions) {
        if (session.userUuid === userUuid) sessions.delete(token);
      }
      return Promise.resolve();
    });
    const refreshTokens = {
      setUserRefreshTokenInTx: jest.fn(saveToken),
      setUserRefreshToken: jest.fn(saveToken),
      deleteAllUserRefreshTokensInTx: deleteAll,
      deleteAllUserRefreshTokens: deleteAll,
      findUserByRefreshToken: jest.fn((token: string) => {
        const session = sessions.get(token);
        if (!session) throw new UnauthorizedException();
        return Promise.resolve(session);
      }),
      deleteUserRefreshToken: jest.fn((token: string) => {
        sessions.delete(token);
        return Promise.resolve();
      }),
      deleteUserRefreshTokenBySessionId: jest.fn(
        (userUuid: string, sessionId: string) => {
          for (const [token, session] of sessions) {
            if (
              session.userUuid === userUuid &&
              session.sessionId === sessionId
            ) {
              sessions.delete(token);
            }
          }
          return Promise.resolve();
        },
      ),
      findUserRefreshTokenBySessionId: jest.fn(
        (userUuid: string, sessionId: string) =>
          Promise.resolve(
            [...sessions.values()].find(
              (session) =>
                session.userUuid === userUuid &&
                session.sessionId === sessionId,
            ) ?? null,
          ),
      ),
    };
    const config = new ConfigService({
      USER_JWT_SECRET: 'test-jwt-secret',
      USER_JWT_EXPIRE: '15m',
      USER_JWT_AUDIENCE: 'test',
      USER_JWT_ISSUER: 'test',
      USER_REFRESH_TOKEN_EXPIRE: '7d',
      REFRESH_TOKEN_HMAC_SECRET: 'test-hmac-secret',
      POLICY_API_URL: 'https://example.com/policy',
      SERVICE_NAME_FOR_POLICY_VERSION: 'test',
    });
    const tx = {};
    const args = [
      { getUserInfo: jest.fn().mockResolvedValue(user) },
      new JwtService(),
      config,
      { $transaction: (callback: (tx: object) => unknown) => callback(tx) },
      {
        get: () => of({ data: { service: 'test', tos: 'v1', privacy: 'v1' } }),
      },
      {
        findUserByStudentNumberInTx: jest.fn().mockResolvedValue(user),
        upsertUserInTx: jest.fn().mockResolvedValue(user),
        findUser: jest.fn().mockResolvedValue(user),
        deleteUserInTx: jest.fn().mockResolvedValue(undefined),
      },
      refreshTokens,
      {
        getLatestUserConsentInTx: jest
          .fn()
          .mockResolvedValue({ version: 'v1' }),
        deleteUserConsentsInTx: jest.fn().mockResolvedValue(undefined),
      },
      { createAuditLogInTx: jest.fn().mockResolvedValue(undefined) },
      {
        deleteAllUserPushSubscriptionsInTx: jest
          .fn()
          .mockResolvedValue(undefined),
        deleteAllUserLaundryRoomSubscriptionsInTx: jest
          .fn()
          .mockResolvedValue(undefined),
      },
    ] as unknown as ConstructorParameters<typeof AuthService>;
    const service = new AuthService(...args);
    const strategy = new UserStrategy(service, config);
    const controller = new AuthController(service);
    const payload = (token: string) =>
      new JwtService().verify<{ sub: string; sessionId: string }>(token, {
        secret: 'test-jwt-secret',
      });
    return { service, strategy, controller, sessions, refreshTokens, payload };
  }

  it('keeps both logins valid with distinct refresh tokens and sessions', async () => {
    const { service, strategy, sessions, payload } = setup();
    const first = await service.userLogin('Bearer oauth-token');
    const second = await service.userLogin('Bearer oauth-token');

    expect(sessions.size).toBe(2);
    expect(first.refresh_token).not.toBe(second.refresh_token);
    expect(payload(first.access_token).sessionId).not.toBe(
      payload(second.access_token).sessionId,
    );
    await expect(
      strategy.validate(payload(first.access_token)),
    ).resolves.toMatchObject(user);
    await expect(
      strategy.validate(payload(second.access_token)),
    ).resolves.toMatchObject(user);
  });

  it('rotates one refresh token while preserving both sessions', async () => {
    const { service, strategy, sessions, payload } = setup();
    const first = await service.userLogin('Bearer oauth-token');
    const second = await service.userLogin('Bearer oauth-token');
    const rotated = await service.userRefresh(first.refresh_token);

    expect(sessions.size).toBe(2);
    expect(rotated.refresh_token).not.toBe(first.refresh_token);
    expect(payload(rotated.access_token).sessionId).toBe(
      payload(first.access_token).sessionId,
    );
    expect(rotated.refreshTokenExpiredAt).toEqual(first.refreshTokenExpiredAt);
    await expect(service.userRefresh(first.refresh_token)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      strategy.validate(payload(second.access_token)),
    ).resolves.toMatchObject(user);
    await expect(
      service.userRefresh(second.refresh_token),
    ).resolves.toBeDefined();
  });

  it('logs out only the authenticated session and clears its cookie', async () => {
    const { service, strategy, controller, sessions, payload } = setup();
    const first = await service.userLogin('Bearer oauth-token');
    const second = await service.userLogin('Bearer oauth-token');
    const authenticatedUser = await strategy.validate(
      payload(first.access_token),
    );
    const clearCookie = jest.fn();
    await controller.logout(authenticatedUser, {
      clearCookie,
    } as unknown as Response);

    expect(sessions.size).toBe(1);
    expect(clearCookie).toHaveBeenCalledWith('refresh_token', {
      path: '/auth',
    });
    await expect(
      strategy.validate(payload(first.access_token)),
    ).rejects.toThrow(UnauthorizedException);
    await expect(service.userRefresh(first.refresh_token)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      strategy.validate(payload(second.access_token)),
    ).resolves.toMatchObject(user);
    await expect(
      service.userRefresh(second.refresh_token),
    ).resolves.toBeDefined();
  });

  it('invalidates all sessions when the account is deactivated', async () => {
    const { service, strategy, sessions, payload } = setup();
    const first = await service.userLogin('Bearer oauth-token');
    const second = await service.userLogin('Bearer oauth-token');
    await service.deactivateUser(user.uuid);

    expect(sessions.size).toBe(0);
    await expect(
      strategy.validate(payload(first.access_token)),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      strategy.validate(payload(second.access_token)),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('scopes repository deletion by both user and session', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const repository = new UserRefreshTokenRepository({
      userRefreshToken: { deleteMany },
    } as unknown as ConstructorParameters<
      typeof UserRefreshTokenRepository
    >[0]);

    await repository.deleteUserRefreshTokenBySessionId(user.uuid, 'session-a');

    expect(deleteMany).toHaveBeenCalledWith({
      where: { userUuid: user.uuid, sessionId: 'session-a' },
    });
  });
});
