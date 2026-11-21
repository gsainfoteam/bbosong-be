import { EventEmitter } from 'node:events';
import { ApnsHttpClient } from './apns-http-client';

class FakeRequest extends EventEmitter {
  setTimeout = jest.fn();
  close = jest.fn();
  end = jest.fn();
}

class FakeSession extends EventEmitter {
  closed = false;
  destroyed = false;
  setTimeout = jest.fn();
  close = jest.fn();
  request = jest.fn();
}

const session = new FakeSession();
jest.mock('node:http2', () => ({ connect: jest.fn(() => session) }));

describe('ApnsHttpClient', () => {
  let client: ApnsHttpClient;
  let request: FakeRequest;

  beforeEach(() => {
    client = new ApnsHttpClient();
    request = new FakeRequest();
    session.request.mockReturnValue(request);
  });

  const post = () => client.post('host', '/3/device/ab', { a: 'b' }, '{}');

  it('resolves with the status and body of a normal response', async () => {
    const promise = post();
    request.emit('response', { ':status': 200 });
    request.emit('data', Buffer.from('{"ok":'));
    request.emit('data', Buffer.from('true}'));
    request.emit('end');
    request.emit('close');
    await expect(promise).resolves.toEqual({
      status: 200,
      body: '{"ok":true}',
    });
  });

  it('rejects when the stream is closed before any response', async () => {
    const promise = post();
    request.emit('close');
    await expect(promise).rejects.toThrow('closed without a response');
  });

  it('rejects on a stream error and ignores the following close', async () => {
    const promise = post();
    request.emit('error', new Error('reset'));
    request.emit('close');
    await expect(promise).rejects.toThrow('reset');
  });

  it('rejects on timeout', async () => {
    const promise = post();
    (request.setTimeout.mock.calls[0] as [number, () => void])[1]();
    await expect(promise).rejects.toThrow('timed out');
    expect(request.close).toHaveBeenCalled();
  });
});
