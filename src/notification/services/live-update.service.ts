import { Loggable } from '@lib/logger';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BbosongConfigService } from '../../config/bbosong-config.service';
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
/** How often the scheduler looks for sessions whose tick is due. */
const TICK_CHECK_INTERVAL_MS = 15_000;
/** Total attempts (first + retries) of the one-off message sent at `endsAt`. */
const MAX_FINAL_ATTEMPTS = 3;

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
  /** The transition message did not reach every device: resend on next sync. */
  retryTransition?: boolean;
  /**
   * The one-off message at `endsAt` is done (sent, given up, or not wanted
   * because `endsAt` had already passed when the entry was recorded). Reset when
   * a sync moves `endsAt` into the future again.
   */
  finalDone?: boolean;
  finalAttempts?: number;
  /** Resends of a washer's transition message that did not reach every device. */
  retryAttempts?: number;
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
    configService: BbosongConfigService,
  ) {
    this.tickIntervalMs = configService.liveUpdateTickIntervalMs;
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
   * Washers (finish time entered by the user) only get the one-off message
   * once `endsAt` has passed, since their cycle may run longer than entered.
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
    const finals = [...this.lastSent.entries()].filter(([, entry]) => {
      const { current } = entry;
      return (
        !entry.finalDone &&
        current.endsAt !== null &&
        current.endsAt <= nowSeconds &&
        (current.state === 'RUNNING' || current.state === 'COOLING') &&
        // First attempt is immediate (attemptedAt only moves on a retry).
        (!entry.finalAttempts ||
          nowMs - entry.attemptedAt >= this.tickIntervalMs)
      );
    });
    // Washers have no ThinQ sync to re-register them, so a transition message
    // that missed a device is retried here (until `endsAt`, when the final goes).
    const retries = [...this.lastSent.entries()].filter(([, entry]) => {
      const { current } = entry;
      return (
        entry.session.kind === MachineType.WASHER &&
        entry.retryTransition === true &&
        (entry.retryAttempts ?? 0) < MAX_FINAL_ATTEMPTS &&
        (current.endsAt === null || current.endsAt > nowSeconds) &&
        nowMs - entry.attemptedAt >= this.tickIntervalMs
      );
    });
    await Promise.all([
      ...retries.map(([key, entry]) => this.sendRetry(key, entry, nowMs)),
      ...finals.map(([key, entry]) => this.sendFinal(key, entry, nowMs)),
      ...due.map(async ([key, entry]) => {
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
          entry.retryTransition = false;
        } else if (failed === 0) {
          // No Live Update device left (unsubscribed / flag off): stop ticking.
          // The next ThinQ sync registers the session again.
          this.lastSent.delete(key);
        }
        // failed > 0 and nothing sent: retried at the next tick.
      }),
    ]);
  }

  /** Resends the current state of a washer session to the owner's devices. */
  private async sendRetry(
    key: string,
    entry: LastSent,
    nowMs: number,
  ): Promise<void> {
    const nowSeconds = Math.floor(nowMs / 1000);
    const { endsAt } = entry.current;
    entry.attemptedAt = nowMs; // claim; also spaces out retries
    entry.retryAttempts = (entry.retryAttempts ?? 0) + 1;
    const { sent, failed } = await this.fcmService.sendLiveUpdateToUser(
      entry.ownerUuid,
      buildLiveUpdateData(entry.session, {
        state: entry.current.state,
        endsAt,
        remainingMinutes:
          endsAt === null
            ? null
            : Math.max(0, Math.ceil((endsAt - nowSeconds) / 60)),
        updatedAt: nowSeconds,
      }),
    );
    if (this.lastSent.get(key) !== entry) return;
    if (sent > 0) {
      entry.sentAt = nowMs;
      entry.retryTransition = false;
    } else if (failed === 0) {
      this.lastSent.delete(key);
    }
  }

  /**
   * One extra `LIVE_UPDATE` once `endsAt` has passed, so the app can swap the
   * (otherwise negative) countdown for "almost done". Bounded retries.
   */
  private async sendFinal(
    key: string,
    entry: LastSent,
    nowMs: number,
  ): Promise<void> {
    const nowSeconds = Math.floor(nowMs / 1000);
    entry.attemptedAt = nowMs; // claim; also spaces out retries
    entry.finalAttempts = (entry.finalAttempts ?? 0) + 1;
    const { sent, failed } = await this.fcmService.sendLiveUpdateToUser(
      entry.ownerUuid,
      buildLiveUpdateData(entry.session, {
        state: entry.current.state,
        endsAt: entry.current.endsAt,
        remainingMinutes: 0,
        updatedAt: nowSeconds,
      }),
    );
    if (this.lastSent.get(key) !== entry) return;
    if (sent > 0) {
      entry.sentAt = nowMs;
      entry.retryTransition = false;
      entry.finalDone = true;
    } else if (failed === 0) {
      this.lastSent.delete(key);
    } else if (entry.finalAttempts >= MAX_FINAL_ATTEMPTS) {
      entry.finalDone = true;
    }
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
    /** `force`: a user-entered finish time; send even for a small or recent change. */
    options: { force?: boolean } = {},
  ): Promise<void> {
    if (!ownerUuid) return;
    const contentState = buildRunningContentState(
      thinq.state,
      thinq.remainingMinutes,
      now,
    );
    const previous = this.lastSent.get(usingMachineUuid);
    const transitioned =
      !previous ||
      previous.retryTransition === true ||
      previous.state !== contentState.state ||
      previous.ownerUuid !== ownerUuid;
    if (previous) {
      previous.session = session;
      previous.current = contentState;
      // The finish time moved ahead again (or is unknown): arm the final message anew.
      if (
        contentState.endsAt === null ||
        contentState.endsAt > Math.floor(now.getTime() / 1000)
      ) {
        previous.finalDone = false;
        previous.finalAttempts = 0;
      }
    }
    if (!transitioned) {
      const endsAtMoved =
        previous.endsAt === null || contentState.endsAt === null
          ? previous.endsAt !== contentState.endsAt
          : Math.abs(contentState.endsAt - previous.endsAt) >=
            MIN_ENDS_AT_DRIFT_SECONDS;
      const forced =
        options.force === true && previous.endsAt !== contentState.endsAt;
      if (
        !forced &&
        (!endsAtMoved ||
          now.getTime() - previous.sentAt < MIN_UPDATE_INTERVAL_MS)
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
      // A finish time that is already past when recorded is not announced again.
      finalDone:
        contentState.endsAt !== null &&
        contentState.endsAt <= Math.floor(now.getTime() / 1000),
    };
    this.lastSent.set(usingMachineUuid, entry);
    const { failed } = await this.fcmService.sendLiveUpdateToUser(
      ownerUuid,
      buildLiveUpdateData(session, contentState),
    );
    // A device that did not get the update must be retried by the next sync.
    if (failed > 0 && this.lastSent.get(usingMachineUuid) === entry) {
      if (previous && previous.ownerUuid === ownerUuid) {
        this.lastSent.set(usingMachineUuid, previous);
      } else if (previous) {
        // Owner changed: never restore the old owner's entry (it would keep
        // ticking them). Keep the new owner's entry so the next tick or sync
        // retries them.
        entry.retryTransition = true;
      } else if (session.kind === MachineType.WASHER) {
        // No ThinQ sync will register a washer again: keep it so the tick
        // retries the missed devices and the final message still goes out.
        entry.retryTransition = true;
      } else {
        this.lastSent.delete(usingMachineUuid);
      }
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
