import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ClientHttp2Session, connect } from 'node:http2';

export interface ApnsHttpResponse {
  status: number;
  body: string;
}

const REQUEST_TIMEOUT_MS = 10_000;
const SESSION_IDLE_TIMEOUT_MS = 10 * 60_000;

/**
 * Minimal HTTP/2 transport for APNs (which only speaks HTTP/2). Keeps one
 * connection per host open, as Apple recommends, and reconnects on demand.
 */
@Injectable()
export class ApnsHttpClient implements OnModuleDestroy {
  private readonly sessions = new Map<string, ClientHttp2Session>();

  private getSession(host: string): ClientHttp2Session {
    const existing = this.sessions.get(host);
    if (existing && !existing.closed && !existing.destroyed) return existing;

    const session = connect(`https://${host}`);
    const forget = () => {
      if (this.sessions.get(host) === session) this.sessions.delete(host);
    };
    session.on('error', forget);
    session.on('close', forget);
    session.on('goaway', forget);
    session.setTimeout(SESSION_IDLE_TIMEOUT_MS, () => session.close());
    this.sessions.set(host, session);
    return session;
  }

  post(
    host: string,
    path: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<ApnsHttpResponse> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      let request: ReturnType<ClientHttp2Session['request']>;
      try {
        request = this.getSession(host).request({
          ':method': 'POST',
          ':path': path,
          ...headers,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      let status = 0;
      const chunks: Buffer[] = [];
      request.setTimeout(REQUEST_TIMEOUT_MS, () => {
        request.close();
        done(() => reject(new Error('APNs request timed out')));
      });
      request.on('response', (responseHeaders) => {
        status = Number(responseHeaders[':status']);
      });
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () =>
        done(() =>
          resolve({ status, body: Buffer.concat(chunks).toString('utf8') }),
        ),
      );
      request.on('error', (error: Error) => done(() => reject(error)));
      // A remote RST_STREAM can close the stream without 'end' or 'error'.
      request.on('close', () =>
        done(() => reject(new Error('APNs stream closed without a response'))),
      );
      request.end(body);
    });
  }

  onModuleDestroy() {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }
}
