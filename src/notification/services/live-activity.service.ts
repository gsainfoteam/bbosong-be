import { Loggable } from '@lib/logger';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
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

/** How often sessions whose finish time has passed are looked for. */
const OVERDUE_CHECK_INTERVAL_MS = 15_000;
/** Total attempts (first + retries) of the one-off message sent at `endsAt`. */
const MAX_OVERDUE_ATTEMPTS = 3;

interface LastSent {
  state: LiveActivityContentState['state'];
  endsAt: number | null;
  /** Newest finish time seen by a sync, sent or not; the overdue push uses it. */
  latestEndsAt: number | null;
  sentAt: number;
  ownerUuid: string | null;
  /** The one-off message after `endsAt` is done (sent, given up, or not needed). */
  overdueDone?: boolean;
  overdueAttempts?: number;
}

interface ActivityToken {
  userUuid: string;
  pushToken: string;
  environment: LiveActivityEnvironment;
}

@Loggable()
@Injectable()
export class LiveActivityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveActivityService.name);
  /** Last progress update per session; lost on restart (one extra update). */
  private readonly lastSent = new Map<string, LastSent>();

  private timer?: NodeJS.Timeout;
  private checking?: Promise<void>;

  constructor(
    private readonly liveActivityRepository: LiveActivityRepository,
    private readonly apnsService: ApnsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      if (this.checking) return;
      this.checking = this.pushOverdue()
        .catch(() => undefined)
        .finally(() => {
          this.checking = undefined;
        });
    }, OVERDUE_CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.checking;
  }

  /**
   * Once a session's finish time has passed while it still runs (washers may
   * take longer than the entered time), pushes the same state with
   * `remainingMinutes: 0` once so the widget redraws as "almost done" instead
   * of counting below zero. Re-armed when the finish time moves ahead again.
   */
  async pushOverdue(now: Date = new Date()): Promise<void> {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const due = [...this.lastSent.entries()].filter(
      ([, entry]) =>
        !entry.overdueDone &&
        entry.latestEndsAt !== null &&
        entry.latestEndsAt <= nowSeconds &&
        (entry.state === 'RUNNING' || entry.state === 'COOLING'),
    );
    await Promise.all(
      due.map(async ([usingMachineUuid, entry]) => {
        // Claim first so overlapping checks do not double-send.
        entry.overdueDone = true;
        entry.overdueAttempts = (entry.overdueAttempts ?? 0) + 1;
        let failed = false;
        try {
          const { owned } = this.splitByOwner(
            await this.liveActivityRepository.getTokensByUsingMachine(
              usingMachineUuid,
            ),
            entry.ownerUuid,
          );
          if (owned.length === 0) return;
          const contentState: LiveActivityContentState = {
            state: entry.state,
            endsAt: entry.latestEndsAt,
            remainingMinutes: 0,
            updatedAt: nowSeconds,
          };
          const results = await this.pushAndPrune(owned, (token) =>
            this.apnsService.sendLiveActivityUpdate(
              token,
              contentState,
              { highPriority: true },
              now,
            ),
          );
          failed = results.includes('failed');
        } catch (error: unknown) {
          this.logger.warn(
            `Failed to push overdue Live Activity ${usingMachineUuid}: ${formatError(error)}`,
          );
          failed = true;
        }
        if (
          failed &&
          (entry.overdueAttempts ?? 0) < MAX_OVERDUE_ATTEMPTS &&
          this.lastSent.get(usingMachineUuid) === entry
        ) {
          entry.overdueDone = false;
        }
      }),
    );
  }

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
    ownerUuid: string | null,
    thinq: { state: string | null; remainingMinutes: number | null },
    now: Date = new Date(),
    /** `force`: a user-entered finish time; send even for a small or recent change. */
    options: { force?: boolean } = {},
  ): Promise<void> {
    if (!this.apnsService.isEnabled()) return;
    const contentState = buildRunningContentState(
      thinq.state,
      thinq.remainingMinutes,
      now,
    );
    const previous = this.lastSent.get(usingMachineUuid);
    if (previous) {
      // Track the newest finish time even when nothing is sent below, so the
      // overdue push fires at the right time and is re-armed by any extension.
      previous.latestEndsAt = contentState.endsAt;
      if (
        contentState.endsAt === null ||
        contentState.endsAt > Math.floor(now.getTime() / 1000)
      ) {
        previous.overdueDone = false;
        previous.overdueAttempts = 0;
      }
    }
    const stateChanged = !previous || previous.state !== contentState.state;
    const forced =
      options.force === true &&
      !!previous &&
      previous.endsAt !== contentState.endsAt;
    const endsAtMoved =
      !!previous &&
      (previous.endsAt === null || contentState.endsAt === null
        ? previous.endsAt !== contentState.endsAt
        : Math.abs(contentState.endsAt - previous.endsAt) >=
          MIN_ENDS_AT_DRIFT_SECONDS);
    if (!stateChanged && !endsAtMoved && !forced) return;
    if (
      !stateChanged &&
      !forced &&
      previous &&
      now.getTime() - previous.sentAt < MIN_UPDATE_INTERVAL_MS
    ) {
      return;
    }

    const { owned, orphaned } = this.splitByOwner(
      await this.liveActivityRepository.getTokensByUsingMachine(
        usingMachineUuid,
      ),
      ownerUuid,
    );
    // Tokens of users no longer tracking the session only get the end again.
    await this.endAndForget(orphaned, now);
    if (owned.length === 0) return;

    // Record before sending so concurrent events do not double-send.
    const entry: LastSent = {
      state: contentState.state,
      endsAt: contentState.endsAt,
      latestEndsAt: contentState.endsAt,
      sentAt: now.getTime(),
      ownerUuid,
      // A finish time already past when sent is shown as "almost done" by that very update.
      overdueDone:
        contentState.endsAt !== null &&
        contentState.endsAt <= Math.floor(now.getTime() / 1000),
    };
    this.lastSent.set(usingMachineUuid, entry);
    const results = await this.pushAndPrune(owned, (token) =>
      this.apnsService.sendLiveActivityUpdate(
        token,
        contentState,
        { highPriority: stateChanged },
        now,
      ),
    );
    // A device that did not get the update must be retried by the next sync.
    if (
      results.includes('failed') &&
      this.lastSent.get(usingMachineUuid) === entry
    ) {
      if (previous) this.lastSent.set(usingMachineUuid, previous);
      else this.lastSent.delete(usingMachineUuid);
    }
  }

  /**
   * The session finished: show "done" on every registered device but keep the
   * activity (and the Dynamic Island) alive until it is ended explicitly.
   */
  async completeForUsingMachine(
    usingMachineUuid: string,
    ownerUuid: string | null,
    now: Date = new Date(),
  ): Promise<void> {
    this.lastSent.delete(usingMachineUuid);
    const { owned, orphaned } = this.splitByOwner(
      await this.liveActivityRepository.getTokensByUsingMachine(
        usingMachineUuid,
      ),
      ownerUuid,
    );
    await this.endAndForget(orphaned, now);
    const contentState = buildEndContentState(now);
    await this.pushAndPrune(owned, (token) =>
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

  /** Tokens of the session's current user vs. users who stopped tracking it. */
  private splitByOwner<T extends ActivityToken>(
    tokens: T[],
    ownerUuid: string | null,
  ): { owned: T[]; orphaned: T[] } {
    return {
      owned: tokens.filter((token) => token.userUuid === ownerUuid),
      orphaned: tokens.filter((token) => token.userUuid !== ownerUuid),
    };
  }

  /**
   * Ends the activities. Tokens APNs accepted or rejected as dead are
   * forgotten; those that could not be reached are kept so a later sync
   * retries the end.
   */
  private async endAndForget(
    tokens: ActivityToken[],
    now: Date,
  ): Promise<void> {
    if (tokens.length === 0) return;
    const contentState = buildEndContentState(now);
    const results = await Promise.all(
      tokens.map((token) =>
        this.apnsService.sendLiveActivityEnd(token, contentState, now),
      ),
    );
    await this.liveActivityRepository.deleteTokens(
      tokens
        .filter((_, index) => results[index] !== 'failed')
        .map((token) => token.pushToken),
    );
  }

  private async pushAndPrune(
    tokens: ActivityToken[],
    send: (token: ActivityToken) => Promise<ApnsSendResult>,
  ): Promise<ApnsSendResult[]> {
    const results = await Promise.all(tokens.map((token) => send(token)));
    await this.liveActivityRepository.deleteTokens(
      tokens
        .filter((_, index) => results[index] === 'dead-token')
        .map((token) => token.pushToken),
    );
    return results;
  }
}
