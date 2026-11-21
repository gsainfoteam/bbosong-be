import { Loggable } from '@lib/logger';
import { Injectable, Logger } from '@nestjs/common';
import { LiveActivityRepository } from '@lib/database/repositories/live-activity.repository';
import { LiveActivityEnvironment } from 'generated/prisma/client';
import { formatError } from '../../common/utils/format-error.util';
import { buildEndContentState } from '../types/live-activity.type';
import { ApnsService } from './apns.service';

/** Live Activities live at most 8 hours; leave a margin before purging rows. */
const STALE_TOKEN_MS = 9 * 60 * 60_000;

@Loggable()
@Injectable()
export class LiveActivityService {
  private readonly logger = new Logger(LiveActivityService.name);

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
   * Ends the Live Activity on every device registered for the session, then
   * forgets the tokens (the activity is over whether or not APNs accepted it).
   */
  async endForUsingMachine(
    usingMachineUuid: string,
    now: Date = new Date(),
  ): Promise<void> {
    const tokens =
      await this.liveActivityRepository.getTokensByUsingMachine(
        usingMachineUuid,
      );
    if (tokens.length === 0) return;

    const contentState = buildEndContentState(now);
    await Promise.all(
      tokens.map((token) =>
        this.apnsService.sendLiveActivityEnd(token, contentState, now),
      ),
    );
    await this.liveActivityRepository.deleteByUsingMachine(usingMachineUuid);
  }

  /** Ends an activity whose session is already over, without storing the token. */
  async endUnregisteredToken(
    token: { pushToken: string; environment: LiveActivityEnvironment },
    now: Date = new Date(),
  ): Promise<void> {
    await this.apnsService.sendLiveActivityEnd(
      token,
      buildEndContentState(now),
      now,
    );
  }
}
