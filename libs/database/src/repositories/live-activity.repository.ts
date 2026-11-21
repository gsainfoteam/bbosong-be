import { Loggable } from '@lib/logger';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '@lib/database/database.service';
import {
  LiveActivityEnvironment,
  LiveActivityToken,
  Prisma,
} from 'generated/prisma/client';
import { Trace } from '@gsainfoteam/nest-observability';

@Loggable()
@Injectable()
@Trace()
export class LiveActivityRepository {
  private readonly logger = new Logger(LiveActivityRepository.name);
  constructor(private readonly databaseService: DatabaseService) {}

  private async run<T>(methodName: string, op: Promise<T>): Promise<T> {
    return await op.catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        this.logger.error(`${methodName} prisma error: ${error.message}`);
        throw new InternalServerErrorException('Database Error');
      }
      this.logger.error(`${methodName} error: ${error}`);
      throw new InternalServerErrorException('Unknown Error');
    });
  }

  /**
   * Upserts the token of one Live Activity. A token is globally unique, so an
   * existing row (e.g. re-registered after rotation or a re-login) is moved to
   * the given user/session.
   */
  async upsertToken(params: {
    userUuid: string;
    usingMachineUuid: string;
    pushToken: string;
    environment: LiveActivityEnvironment;
  }): Promise<LiveActivityToken> {
    const { userUuid, usingMachineUuid, pushToken, environment } = params;
    return this.run(
      'upsertToken',
      this.databaseService.liveActivityToken.upsert({
        where: { pushToken },
        create: { userUuid, usingMachineUuid, pushToken, environment },
        update: { userUuid, usingMachineUuid, environment },
      }),
    );
  }

  async getTokensByUsingMachine(
    usingMachineUuid: string,
  ): Promise<LiveActivityToken[]> {
    return this.run(
      'getTokensByUsingMachine',
      this.databaseService.liveActivityToken.findMany({
        where: { usingMachineUuid },
      }),
    );
  }

  /** Tokens of every session of the machine except the given (current) one. */
  async getTokensOfOtherSessions(
    machineUuid: string,
    exceptUsingMachineUuid: string,
  ): Promise<LiveActivityToken[]> {
    return this.run(
      'getTokensOfOtherSessions',
      this.databaseService.liveActivityToken.findMany({
        where: {
          usingMachine: { machineUuid },
          usingMachineUuid: { not: exceptUsingMachineUuid },
        },
      }),
    );
  }

  /** Tokens of the user on any session of the machine. */
  async getUserTokensOnMachine(
    userUuid: string,
    machineUuid: string,
  ): Promise<LiveActivityToken[]> {
    return this.run(
      'getUserTokensOnMachine',
      this.databaseService.liveActivityToken.findMany({
        where: { userUuid, usingMachine: { machineUuid } },
      }),
    );
  }

  /** Removes a token owned by the user; unknown or foreign tokens are ignored. */
  async deleteUserToken(userUuid: string, pushToken: string): Promise<number> {
    const result = await this.run(
      'deleteUserToken',
      this.databaseService.liveActivityToken.deleteMany({
        where: { userUuid, pushToken },
      }),
    );
    return result.count;
  }

  async deleteTokens(pushTokens: string[]): Promise<number> {
    if (pushTokens.length === 0) return 0;
    const result = await this.run(
      'deleteTokens',
      this.databaseService.liveActivityToken.deleteMany({
        where: { pushToken: { in: pushTokens } },
      }),
    );
    return result.count;
  }

  async deleteByUsingMachine(usingMachineUuid: string): Promise<number> {
    const result = await this.run(
      'deleteByUsingMachine',
      this.databaseService.liveActivityToken.deleteMany({
        where: { usingMachineUuid },
      }),
    );
    return result.count;
  }

  /** Live Activities last at most 8 hours, so older rows are dead. */
  async deleteStale(olderThan: Date): Promise<number> {
    const result = await this.run(
      'deleteStale',
      this.databaseService.liveActivityToken.deleteMany({
        where: { updatedAt: { lt: olderThan } },
      }),
    );
    return result.count;
  }
}
