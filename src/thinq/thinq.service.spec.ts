import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AxiosError, AxiosHeaders } from 'axios';
import { of, throwError } from 'rxjs';
import { ThinqModule } from './thinq.module';
import { ThinqService } from './thinq.service';

describe('ThinQ Connect HTTP client', () => {
  const credentials = {
    THINQ_PAT: 'test-pat',
    THINQ_COUNTRY_CODE: 'KR',
    THINQ_CLIENT_ID: 'test-client',
    THINQ_API_KEY: 'test-api-key',
  };
  const http = { get: jest.fn() };
  function config(values: Record<string, unknown>) {
    return {
      get: jest.fn(
        (key: string, fallback?: unknown) => values[key] ?? fallback,
      ),
    } as unknown as ConfigService;
  }
  function response(value: unknown) {
    return of({ data: { response: value } });
  }
  function failure(status: number) {
    const request = {
      headers: new AxiosHeaders({ Authorization: 'Bearer test-pat' }),
    };
    return throwError(
      () =>
        new AxiosError('test-pat', 'ERR_BAD_RESPONSE', request, undefined, {
          status,
          statusText: 'Error',
          data: {},
          headers: {},
          config: request,
        }),
    );
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  it('uses the documented endpoints, envelope and PAT headers with fresh UUIDv4 message IDs', async () => {
    const service = new ThinqService(http as never, config(credentials));
    const devices = [
      {
        deviceId: 'dryer-id',
        deviceInfo: { deviceType: 'dryer', modelName: 'model', alias: 'Dryer' },
      },
    ];
    const state = {
      runState: { currentState: 'RUNNING' },
      timer: { remainHour: 1, remainMinute: 20 },
    };
    http.get
      .mockReturnValueOnce(response(devices))
      .mockReturnValueOnce(response(state));
    await expect(service.getDevices()).resolves.toEqual(devices);
    await expect(service.getDryerState('dryer/id')).resolves.toEqual(state);
    const calls = http.get.mock.calls as [
      string,
      { headers: Record<string, string> },
    ][];
    expect(calls.map(([url]) => url)).toEqual([
      'https://api-kic.lgthinq.com/devices',
      'https://api-kic.lgthinq.com/devices/dryer%2Fid/state',
    ]);
    const ids: string[] = [];
    for (const [, options] of calls) {
      expect(options.headers).toMatchObject({
        Authorization: 'Bearer test-pat',
        'x-country': 'KR',
        'x-client-id': 'test-client',
        'x-api-key': 'test-api-key',
      });
      const id = options.headers['x-message-id'];
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      const uuid = Buffer.from(id, 'base64url');
      expect(uuid[6] >> 4).toBe(4);
      expect(uuid[8] >> 6).toBe(2);
      ids.push(id);
    }
    expect(new Set(ids).size).toBe(2);
  });

  it.each(Object.keys(credentials))(
    'disables requests when %s is missing',
    async (key) => {
      const service = new ThinqService(
        http as never,
        config({ ...credentials, [key]: '' }),
      );
      expect(service.enabled).toBe(false);
      await expect(service.getDevices()).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(http.get).not.toHaveBeenCalled();
    },
  );

  it('initializes its Nest module without credentials and configures bounded HTTP requests', async () => {
    const module = await Test.createTestingModule({
      imports: [ThinqModule],
    })
      .useMocker((token) => (token === ConfigService ? config({}) : undefined))
      .compile();
    await module.init();
    expect(module.get(ThinqService).enabled).toBe(false);
    expect(module.get(HttpService).axiosRef.defaults).toMatchObject({
      timeout: 10_000,
      maxRedirects: 0,
    });
    await module.close();
  });

  it.each(['http://api-kic.lgthinq.com', 'https://example.com'])(
    'rejects undocumented servers: %s',
    (url) => {
      expect(
        new ThinqService(
          http as never,
          config({ ...credentials, THINQ_BASE_URL: url }),
        ).enabled,
      ).toBe(false);
    },
  );

  it.each([
    [undefined, 60_000],
    ['', 60_000],
    ['invalid', 60_000],
    ['-1', 60_000],
    ['1', 60_000],
    ['Infinity', 60_000],
    ['86401', 60_000],
    ['120', 120_000],
  ])('bounds the configured interval %s to %i ms', (value, expected) => {
    expect(
      new ThinqService(
        http as never,
        config({ ...credentials, THINQ_POLL_INTERVAL_SECONDS: value }),
      ).pollIntervalMs,
    ).toBe(expected);
  });

  it('backs off shared requests after 429 and increases the wait for repeated limits', async () => {
    const service = new ThinqService(http as never, config(credentials));
    http.get.mockReturnValue(failure(429));
    await expect(service.getDevices()).rejects.toThrow('HTTP 429');
    await expect(service.getDryerState('dryer')).rejects.toThrow('backing off');
    expect(http.get).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60_000);
    await expect(service.getDevices()).rejects.toThrow('HTTP 429');
    jest.advanceTimersByTime(60_000);
    await expect(service.getDevices()).rejects.toThrow('backing off');
    jest.advanceTimersByTime(60_000);
    http.get.mockReturnValue(response([]));
    await expect(service.getDevices()).resolves.toEqual([]);
  });

  it.each([401, 403])(
    'backs off invalid credentials for HTTP %i without exposing request secrets',
    async (status) => {
      const service = new ThinqService(http as never, config(credentials));
      http.get.mockReturnValue(failure(status));
      await expect(service.getDevices()).rejects.toThrow(
        `ThinQ request failed (HTTP ${status}).`,
      );
      try {
        await service.getDevices();
      } catch (error) {
        expect(String(error)).not.toContain('test-pat');
        expect(JSON.stringify(error)).not.toContain('Authorization');
      }
      expect(http.get).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(900_000);
      http.get.mockReturnValue(response([]));
      await expect(service.getDevices()).resolves.toEqual([]);
    },
  );

  it('recovers from network errors without exposing Axios request headers', async () => {
    const service = new ThinqService(http as never, config(credentials));
    http.get
      .mockReturnValueOnce(throwError(() => new Error('test-pat')))
      .mockReturnValueOnce(response([]));
    await expect(service.getDevices()).rejects.toThrow('ThinQ request failed.');
    await expect(service.getDevices()).resolves.toEqual([]);
  });

  it.each([null, {}, [{ deviceId: 1 }]])(
    'rejects malformed device lists: %j',
    async (value) => {
      const service = new ThinqService(http as never, config(credentials));
      http.get.mockReturnValue(response(value));
      await expect(service.getDevices()).rejects.toThrow(
        'Invalid ThinQ device list.',
      );
    },
  );

  it.each([null, 'offline', []])(
    'rejects malformed dryer states: %j',
    async (value) => {
      const service = new ThinqService(http as never, config(credentials));
      http.get.mockReturnValue(response(value));
      await expect(service.getDryerState('dryer')).rejects.toThrow(
        'Invalid ThinQ dryer state.',
      );
    },
  );
});
