import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, verify } from 'node:crypto';
import { LiveActivityEnvironment } from '../../../generated/prisma/enums';
import { buildEndContentState } from '../types/live-activity.type';
import { ApnsService } from './apns.service';

jest.mock('@lib/logger', () => ({ Loggable: () => () => undefined }));
jest.mock(
  'generated/prisma/client',
  () =>
    jest.requireActual<typeof import('../../../generated/prisma/enums')>(
      '../../../generated/prisma/enums',
    ),
  { virtual: true },
);

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
});
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

type Post = jest.Mock<
  Promise<{ status: number; body: string }>,
  [string, string, Record<string, string>, string]
>;

describe('ApnsService', () => {
  const now = new Date('2026-11-21T03:00:00Z');
  const token = {
    pushToken: 'ab12cd34ef56ab12cd34ef56',
    environment: LiveActivityEnvironment.PRODUCTION,
  };
  const contentState = buildEndContentState(now);
  const ok = { status: 200, body: '' };
  let post: Post;

  const create = (env: Record<string, string | undefined> = {}) => {
    const values: Record<string, string | undefined> = {
      APNS_KEY_P8: pem,
      APNS_KEY_ID: 'KEYID12345',
      APNS_TEAM_ID: 'TEAMID1234',
      APNS_BUNDLE_ID: 'kr.example.app',
      ...env,
    };
    const service = new ApnsService(
      { get: (key: string) => values[key] } as unknown as ConfigService,
      { post } as never,
    );
    service.onModuleInit();
    return service;
  };

  const sendWithTimers = async (service: ApnsService) => {
    const result = service.sendLiveActivityEnd(token, contentState, now);
    await jest.advanceTimersByTimeAsync(10_000);
    return result;
  };

  beforeEach(() => {
    jest.useFakeTimers({ now });
    post = jest.fn() as Post;
  });
  afterEach(() => jest.useRealTimers());

  it.each(['APNS_KEY_P8', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_BUNDLE_ID'])(
    'is disabled without %s',
    async (missing) => {
      const service = create({ [missing]: undefined });
      expect(service.isEnabled()).toBe(false);
      await expect(
        service.sendLiveActivityEnd(token, contentState, now),
      ).resolves.toBe('disabled');
      expect(post).not.toHaveBeenCalled();
    },
  );

  it('accepts the key base64-encoded or with escaped newlines', () => {
    expect(
      create({ APNS_KEY_P8: Buffer.from(pem).toString('base64') }).isEnabled(),
    ).toBe(true);
    expect(
      create({ APNS_KEY_P8: pem.trim().replace(/\n/g, '\\n') }).isEnabled(),
    ).toBe(true);
  });

  it('rejects an invalid key without echoing it', () => {
    expect(() => create({ APNS_KEY_P8: 'not-a-key-secret' })).toThrow(
      /APNS_KEY_P8 must be/,
    );
    expect(() => create({ APNS_KEY_P8: 'not-a-key-secret' })).not.toThrow(
      /not-a-key-secret/,
    );
  });

  it('sends a silent end event that dismisses immediately to the production host', async () => {
    post.mockResolvedValue(ok);
    await expect(
      create().sendLiveActivityEnd(token, contentState, now),
    ).resolves.toBe('sent');

    const [host, path, headers, body] = post.mock.calls[0];
    const seconds = Math.floor(now.getTime() / 1000);
    expect(host).toBe('api.push.apple.com');
    expect(path).toBe(`/3/device/${token.pushToken}`);
    expect(headers).toMatchObject({
      'apns-push-type': 'liveactivity',
      'apns-topic': 'kr.example.app.push-type.liveactivity',
      'apns-priority': '10',
    });
    expect(JSON.parse(body)).toEqual({
      aps: {
        timestamp: seconds,
        event: 'end',
        'content-state': contentState,
        'dismissal-date': seconds,
      },
    });
    expect(body).not.toContain('"alert"');
  });

  it('sends an update that keeps the activity alive', async () => {
    post.mockResolvedValue(ok);
    const state = { ...contentState, state: 'RUNNING' as const };
    await expect(
      create().sendLiveActivityUpdate(token, state, {}, now),
    ).resolves.toBe('sent');
    const [, , headers, body] = post.mock.calls[0];
    expect(headers['apns-priority']).toBe('5');
    expect(JSON.parse(body)).toEqual({
      aps: {
        timestamp: Math.floor(now.getTime() / 1000),
        event: 'update',
        'content-state': state,
      },
    });
    await create().sendLiveActivityUpdate(
      token,
      state,
      { highPriority: true },
      now,
    );
    expect(post.mock.calls[1][2]['apns-priority']).toBe('10');
  });

  it('uses the sandbox host for SANDBOX tokens', async () => {
    post.mockResolvedValue(ok);
    await create().sendLiveActivityEnd(
      { ...token, environment: LiveActivityEnvironment.SANDBOX },
      contentState,
      now,
    );
    expect(post.mock.calls[0][0]).toBe('api.sandbox.push.apple.com');
  });

  it('signs a verifiable ES256 provider token and reuses it', async () => {
    post.mockResolvedValue(ok);
    const service = create();
    await service.sendLiveActivityEnd(token, contentState, now);
    await service.sendLiveActivityEnd(token, contentState, now);

    const first = post.mock.calls[0][2].authorization;
    expect(post.mock.calls[1][2].authorization).toBe(first);
    const [header, claims, signature] = first.replace('bearer ', '').split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'ES256',
      kid: 'KEYID12345',
    });
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      iss: 'TEAMID1234',
      iat: Math.floor(now.getTime() / 1000),
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });

  it('issues a new provider token after the cache window', async () => {
    post.mockResolvedValue(ok);
    const service = create();
    await service.sendLiveActivityEnd(token, contentState, now);
    jest.setSystemTime(new Date(now.getTime() + 41 * 60_000));
    await service.sendLiveActivityEnd(token, contentState, now);
    expect(post.mock.calls[1][2].authorization).not.toBe(
      post.mock.calls[0][2].authorization,
    );
  });

  it.each([
    [410, '{"reason":"Unregistered"}'],
    [400, '{"reason":"BadDeviceToken"}'],
    [400, '{"reason":"DeviceTokenNotForTopic"}'],
  ])(
    'reports a dead token for %s %s without retrying',
    async (status, body) => {
      post.mockResolvedValue({ status, body });
      await expect(
        create().sendLiveActivityEnd(token, contentState, now),
      ).resolves.toBe('dead-token');
      expect(post).toHaveBeenCalledTimes(1);
    },
  );

  it('fails without retrying on other client errors', async () => {
    post.mockResolvedValue({ status: 400, body: '{"reason":"BadPayload"}' });
    await expect(
      create().sendLiveActivityEnd(token, contentState, now),
    ).resolves.toBe('failed');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and then succeeds', async () => {
    post
      .mockResolvedValueOnce({ status: 503, body: '' })
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(ok);
    await expect(sendWithTimers(create())).resolves.toBe('sent');
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('gives up after repeated transient failures', async () => {
    post.mockResolvedValue({
      status: 429,
      body: '{"reason":"TooManyRequests"}',
    });
    await expect(sendWithTimers(create())).resolves.toBe('failed');
    expect(post).toHaveBeenCalledTimes(3);
  });

  it('refreshes the provider token when APNs reports it expired', async () => {
    post
      .mockResolvedValueOnce({
        status: 403,
        body: '{"reason":"ExpiredProviderToken"}',
      })
      .mockResolvedValueOnce(ok);
    const service = create();
    jest.setSystemTime(now);
    const promise = service.sendLiveActivityEnd(token, contentState, now);
    await jest.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toBe('sent');
    expect(post).toHaveBeenCalledTimes(2);
  });
});
