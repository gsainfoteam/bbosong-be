import { Loggable } from '@lib/logger';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MachineType } from 'generated/prisma/client';
import {
  LiveActivityContentState,
  buildEndContentState,
  buildRunningContentState,
} from '../types/live-activity.type';
import {
  LiveUpdateSession,
  buildLiveUpdateData,
} from '../types/live-update.type';
import { FcmService } from './fcm.service';

/** Ignore finish-time drift below this; the app's own countdown covers it. */
const MIN_ENDS_AT_DRIFT_SECONDS = 120;
/** Minimum spacing of messages when only the finish time moved. */
const MIN_UPDATE_INTERVAL_MS = 60_000;
const DEFAULT_TICK_INTERVAL_SECONDS = 180;
/** Lower bound keeps ticks clear of the 60s correction throttle. */
const MIN_TICK_INTERVAL_SECONDS = 60;
const MAX_TICK_INTERVAL_SECONDS = 3600;
/** How often the scheduler looks for sessions whose tick is due. */
const TICK_CHECK_INTERVAL_MS = 15_000;

interface LastSent {
  state: string;
  ownerUuid: string;
  endsAt: number | null;
  sentAt: number;
  /** Latest known values (updated on every sync, sent or not), used by ticks. */
  session: LiveUpdateSession;
  current: LiveActivityContentState;
  /** Last send attempt incl. failed ticks; a tick is due `tickMs` after it. */
  attemptedAt: number;
}

/**
 * Android 16 Live Update: sends FCM data-only messages at state transitions
 * and, while the finish time is known, a periodic `LIVE_UPDATE` tick. The app
 * redraws the ProgressStyle bar from `startedAt`..`endsAt` on every message
 * because the OS does not advance it.
 */
@Loggable()
@Injectable()
export class LiveUpdateService implements OnModuleInit, OnModuleDestroy {
  /**
   * Last state sent per session; lost on restart (one extra message, and no
   * ticks until the next ThinQ sync re-registers the session).
   */
  private readonly lastSent = new Map<string, LastSent>();
  /** 0 disables ticks. */
  readonly tickIntervalMs: number;
  private timer?: NodeJS.Timeout;
  private ticking?: Promise<void>;

  constructor(
    private readonly fcmService: FcmService,
    configService: ConfigService,
  ) {
    const raw = configService.get<string | number>(
      'LIVE_UPDATE_TICK_INTERVAL_SECONDS',
    );
    const seconds =
      raw === undefined || raw === null || raw === '' ? NaN : Number(raw);
    if (seconds === 0) this.tickIntervalMs = 0;
    else if (
      Number.isFinite(seconds) &&
      seconds >= MIN_TICK_INTERVAL_SECONDS &&
      seconds <= MAX_TICK_INTERVAL_SECONDS
    ) {
      this.tickIntervalMs = seconds * 1000;
    } else {
      this.tickIntervalMs = DEFAULT_TICK_INTERVAL_SECONDS * 1000;
    }
  }

  onModuleInit(): void {
    if (this.tickIntervalMs === 0) return;
    this.timer = setInterval(() => {
      if (this.ticking) return;
      this.ticking = this.tick()
        .catch(() => undefined)
        .finally(() => {
          this.ticking = undefined;
        });
    }, TICK_CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.ticking;
  }

  /**
   * Sends a tick for every dryer session whose finish time is known and whose
   * last message (transition, correction or tick) is at least one tick old.
   * Stops for a session when its owner has no Live Update device any more.
   */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.tickIntervalMs === 0) return;
    const nowMs = now.getTime();
    const nowSeconds = Math.floor(nowMs / 1000);
    const due = [...this.lastSent.entries()].filter(([, entry]) => {
      const { current } = entry;
      return (
        entry.session.kind === MachineType.DRYER &&
        current.endsAt !== null &&
        current.endsAt > nowSeconds &&
        (current.state === 'RUNNING' ||
          current.state === 'COOLING' ||
          current.state === 'PAUSE') &&
        nowMs - entry.attemptedAt >= this.tickIntervalMs
      );
    });
    await Promise.all(
      due.map(async ([key, entry]) => {
        const endsAt = entry.current.endsAt!;
        // Claim before sending so overlapping runs do not double-send.
        entry.attemptedAt = nowMs;
        const { sent, failed } = await this.fcmService.sendLiveUpdateToUser(
          entry.ownerUuid,
          buildLiveUpdateData(entry.session, {
            state: entry.current.state,
            endsAt,
            remainingMinutes: Math.max(
              0,
              Math.ceil((endsAt - nowSeconds) / 60),
            ),
            updatedAt: nowSeconds,
          }),
        );
        if (this.lastSent.get(key) !== entry) return;
        if (sent > 0) {
          entry.sentAt = nowMs;
        } else if (failed === 0) {
          // No Live Update device left (unsubscribed / flag off): stop ticking.
          // The next ThinQ sync registers the session again.
          this.lastSent.delete(key);
        }
        // failed > 0 and nothing sent: retried at the next tick.
      }),
    );
  }

  /**
   * Pushes the running state of a session when its state (or its owner)
   * changed, or when the finish time moved meaningfully (same rules as the
   * iOS Live Activity).
   */
  async syncRunning(
    usingMachineUuid: string,
    ownerUuid: string | null,
    session: LiveUpdateSession,
    thinq: { state: string | null; remainingMinutes: number | null },
    now: Date = new Date(),
  ): Promise<void> {
    if (!ownerUuid || session.kind !== MachineType.DRYER) return;
    const contentState = buildRunningContentState(
      thinq.state,
      thinq.remainingMinutes,
      now,
    );
    const previous = this.lastSent.get(usingMachineUuid);
    const transitioned =
      !previous ||
      previous.state !== contentState.state ||
      previous.ownerUuid !== ownerUuid;
    if (previous) {
      previous.session = session;
      previous.current = contentState;
    }
    if (!transitioned) {
      const endsAtMoved =
        previous.endsAt === null || contentState.endsAt === null
          ? previous.endsAt !== contentState.endsAt
          : Math.abs(contentState.endsAt - previous.endsAt) >=
            MIN_ENDS_AT_DRIFT_SECONDS;
      if (
        !endsAtMoved ||
        now.getTime() - previous.sentAt < MIN_UPDATE_INTERVAL_MS
      ) {
        return;
      }
    }

    // Record before sending so concurrent events do not double-send.
    const entry: LastSent = {
      state: contentState.state,
      ownerUuid,
      endsAt: contentState.endsAt,
      sentAt: now.getTime(),
      attemptedAt: now.getTime(),
      session,
      current: contentState,
    };
    this.lastSent.set(usingMachineUuid, entry);
    const { failed } = await this.fcmService.sendLiveUpdateToUser(
      ownerUuid,
      buildLiveUpdateData(session, contentState),
    );
    // A device that did not get the update must be retried by the next sync.
    if (failed > 0 && this.lastSent.get(usingMachineUuid) === entry) {
      if (previous) this.lastSent.set(usingMachineUuid, previous);
      else this.lastSent.delete(usingMachineUuid);
    }
  }

  /**
   * The session is over for the user (finished, taken over or no longer
   * tracked): sends the END state so the app finishes the Live Update.
   */
  async end(
    usingMachineUuid: string | null,
    userUuid: string | null,
    session: LiveUpdateSession,
    now: Date = new Date(),
  ): Promise<void> {
    if (usingMachineUuid) this.lastSent.delete(usingMachineUuid);
    // Untracking passes no session id: stop the user's ticks for the machine.
    for (const [key, entry] of this.lastSent) {
      if (
        entry.ownerUuid === userUuid &&
        entry.session.machineUuid === session.machineUuid
      ) {
        this.lastSent.delete(key);
      }
    }
    if (!userUuid) return;
    await this.fcmService.sendLiveUpdateToUser(
      userUuid,
      buildLiveUpdateData(session, buildEndContentState(now)),
    );
  }
}
