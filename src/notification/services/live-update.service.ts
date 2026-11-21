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

interface LastSent {
  state: string;
  ownerUuid: string;
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
   * changed since the last message.
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
    if (
      previous?.state === contentState.state &&
      previous.ownerUuid === ownerUuid
    ) {
      return;
    }

    // Record before sending so concurrent events do not double-send.
    const entry: LastSent = { state: contentState.state, ownerUuid };
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
