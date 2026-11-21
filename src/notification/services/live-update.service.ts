import { Loggable } from '@lib/logger';
import { Injectable } from '@nestjs/common';
import {
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

interface LastSent {
  state: string;
  ownerUuid: string;
  endsAt: number | null;
  sentAt: number;
}

/**
 * Android 16 Live Update: sends FCM data-only messages at state transitions.
 * The app builds the ProgressStyle notification and counts down to `endsAt`
 * locally, so nothing is sent periodically.
 */
@Loggable()
@Injectable()
export class LiveUpdateService {
  /** Last state sent per session; lost on restart (one extra message). */
  private readonly lastSent = new Map<string, LastSent>();

  constructor(private readonly fcmService: FcmService) {}

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
    if (!ownerUuid) return;
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
    if (!userUuid) return;
    await this.fcmService.sendLiveUpdateToUser(
      userUuid,
      buildLiveUpdateData(session, buildEndContentState(now)),
    );
  }
}
