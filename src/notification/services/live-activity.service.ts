import { Loggable } from '@lib/logger';
import { Injectable, Logger } from '@nestjs/common';
import { LiveActivityRepository } from '@lib/database/repositories/live-activity.repository';
import { LiveActivityEnvironment } from 'generated/prisma/client';
import { formatError } from '../../common/utils/format-error.util';
import {
  LiveActivityContentState,
  buildEndContentState,
  buildRunningContentState,
} from '../types/live-activity.type';
import { ApnsSendResult, ApnsService } from './apns.service';

/** Live Activities live at most 8 hours; leave a margin before purging rows. */
const STALE_TOKEN_MS = 9 * 60 * 60_000;
/** Ignore finish-time drift below this; the app's own countdown covers it. */
const MIN_ENDS_AT_DRIFT_SECONDS = 120;
/** Minimum spacing of progress updates when only the finish time moved. */
const MIN_UPDATE_INTERVAL_MS = 60_000;

interface LastSent {
  state: LiveActivityContentState['state'];
  endsAt: number | null;
  sentAt: number;
}

interface ActivityToken {
  pushToken: string;
  environment: LiveActivityEnvironment;
}

@Loggable()
@Injectable()
export class LiveActivityService {
  private readonly logger = new Logger(LiveActivityService.name);
  /** Last progress update per session; lost on restart (one extra update). */
  private readonly lastSent = new Map<string, LastSent>();
  /** Newest session of a machine whose predecessors were already cleaned up. */
  private readonly cleanedSessionByMachine = new Map<string, string>();

  constructor(
    private readonly liveActivityRepository: LiveActivityRepository,
    private readonly apnsService: ApnsService,
  ) {}

  async registerToken(params: {
    userUuid: string;
    usingMachineUuid: string;
    pushToken: string;
    environment: LiveActivityEnvironment;
  }): Promise<void> {
    await this.liveActivityRepository.upsertToken(params);
    // Housekeeping only; never fail a registration because of it.
    this.liveActivityRepository
      .deleteStale(new Date(Date.now() - STALE_TOKEN_MS))
      .catch((error: unknown) =>
        this.logger.warn(
          `Failed to purge stale Live Activity tokens: ${formatError(error)}`,
        ),
      );
  }

  async unregisterToken(userUuid: string, pushToken: string): Promise<void> {
    await this.liveActivityRepository.deleteUserToken(userUuid, pushToken);
  }

  /**
   * Pushes the running state of a session (state changes and meaningful
   * finish-time corrections only) to every device registered for it.
   */
  async syncRunning(
    usingMachineUuid: string,
    thinq: { state: string | null; remainingMinutes: number | null },
    now: Date = new Date(),
  ): Promise<void> {
    if (!this.apnsService.isEnabled()) return;
    const contentState = buildRunningContentState(
      thinq.state,
      thinq.remainingMinutes,
      now,
    );
    const previous = this.lastSent.get(usingMachineUuid);
    const stateChanged = !previous || previous.state !== contentState.state;
    const endsAtMoved =
      !!previous &&
      (previous.endsAt === null || contentState.endsAt === null
        ? previous.endsAt !== contentState.endsAt
        : Math.abs(contentState.endsAt - previous.endsAt) >=
          MIN_ENDS_AT_DRIFT_SECONDS);
    if (!stateChanged && !endsAtMoved) return;
    if (
      !stateChanged &&
      previous &&
      now.getTime() - previous.sentAt < MIN_UPDATE_INTERVAL_MS
    ) {
      return;
    }

    const tokens =
      await this.liveActivityRepository.getTokensByUsingMachine(
        usingMachineUuid,
      );
    if (tokens.length === 0) return;

    // Record before sending so concurrent events do not double-send.
    this.lastSent.set(usingMachineUuid, {
      state: contentState.state,
      endsAt: contentState.endsAt,
      sentAt: now.getTime(),
    });
    await this.pushAndPrune(tokens, (token) =>
      this.apnsService.sendLiveActivityUpdate(
        token,
        contentState,
        { highPriority: stateChanged },
        now,
      ),
    );
  }

  /**
   * The session finished: show "done" on every registered device but keep the
   * activity (and the Dynamic Island) alive until it is ended explicitly.
   */
  async completeForUsingMachine(
    usingMachineUuid: string,
    now: Date = new Date(),
  ): Promise<void> {
    this.lastSent.delete(usingMachineUuid);
    const tokens =
      await this.liveActivityRepository.getTokensByUsingMachine(
        usingMachineUuid,
      );
    const contentState = buildEndContentState(now);
    await this.pushAndPrune(tokens, (token) =>
      this.apnsService.sendLiveActivityUpdate(
        token,
        contentState,
        { highPriority: true },
        now,
      ),
    );
  }

  /** Stores the token of an already finished session and shows "done" on it. */
  async registerCompletedToken(params: {
    userUuid: string;
    usingMachineUuid: string;
    pushToken: string;
    environment: LiveActivityEnvironment;
  }): Promise<void> {
    await this.registerToken(params);
    const result = await this.apnsService.sendLiveActivityUpdate(
      params,
      buildEndContentState(new Date()),
      { highPriority: true },
    );
    if (result === 'dead-token') {
      await this.liveActivityRepository.deleteTokens([params.pushToken]);
    }
  }

  /** Ends and removes the Live Activity of a session on every device. */
  async endForUsingMachine(
    usingMachineUuid: string,
    now: Date = new Date(),
  ): Promise<void> {
    this.lastSent.delete(usingMachineUuid);
    const tokens =
      await this.liveActivityRepository.getTokensByUsingMachine(
        usingMachineUuid,
      );
    await this.endAndForget(tokens, now);
  }

  /**
   * The user stopped tracking the machine: end their Live Activities on it
   * (the running session and any finished one still showing "done").
   */
  async endForUserOnMachine(
    userUuid: string,
    machineUuid: string,
    now: Date = new Date(),
  ): Promise<void> {
    const tokens = await this.liveActivityRepository.getUserTokensOnMachine(
      userUuid,
      machineUuid,
    );
    await this.endAndForget(tokens, now);
  }

  /**
   * A new session started on the machine: finished sessions still showing
   * "done" are obsolete, so end them. Remembered per machine because this is
   * called on every ThinQ event of a running dryer.
   */
  async endStaleForMachine(
    machineUuid: string,
    currentUsingMachineUuid: string,
    now: Date = new Date(),
  ): Promise<void> {
    if (
      this.cleanedSessionByMachine.get(machineUuid) === currentUsingMachineUuid
    )
      return;
    const tokens = await this.liveActivityRepository.getTokensOfOtherSessions(
      machineUuid,
      currentUsingMachineUuid,
    );
    await this.endAndForget(tokens, now);
    this.cleanedSessionByMachine.set(machineUuid, currentUsingMachineUuid);
  }

  private async endAndForget(
    tokens: Array<ActivityToken>,
    now: Date,
  ): Promise<void> {
    if (tokens.length === 0) return;
    const contentState = buildEndContentState(now);
    await Promise.all(
      tokens.map((token) =>
        this.apnsService.sendLiveActivityEnd(token, contentState, now),
      ),
    );
    // The activity is over whether or not APNs accepted the end.
    await this.liveActivityRepository.deleteTokens(
      tokens.map((token) => token.pushToken),
    );
  }

  private async pushAndPrune(
    tokens: ActivityToken[],
    send: (token: ActivityToken) => Promise<ApnsSendResult>,
  ): Promise<void> {
    const results = await Promise.all(
      tokens.map(async (token) => ({
        pushToken: token.pushToken,
        result: await send(token),
      })),
    );
    const dead = results
      .filter(({ result }) => result === 'dead-token')
      .map(({ pushToken }) => pushToken);
    await this.liveActivityRepository.deleteTokens(dead);
  }
}
