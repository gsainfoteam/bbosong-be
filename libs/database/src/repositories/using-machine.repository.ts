import { Loggable } from '@lib/logger';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '@lib/database/database.service';
import { Prisma, UsingMachine } from 'generated/prisma/client';
import { Trace } from '@gsainfoteam/nest-observability';

@Loggable()
@Injectable()
@Trace()
export class UsingMachineRepository {
  private readonly logger = new Logger(UsingMachineRepository.name);
  constructor(private readonly databaseService: DatabaseService) {}

  // Start a new session; repeated start events preserve the existing session.
  async createUsingMachine(
    machineUuid: string,
    userUuid?: string,
    notifyOnCompletion = true,
  ): Promise<UsingMachine> {
    return await this.databaseService
      .$transaction(async (tx) => {
        // Serialize lifecycle changes across processes, including retries.
        await tx.$queryRaw`
          SELECT "uuid" FROM "machine"
          WHERE "uuid" = ${machineUuid}::uuid FOR UPDATE
        `;
        const activeUsage = await tx.usingMachine.findFirst({
          where: { machineUuid, endedAt: null },
        });
        if (activeUsage) return activeUsage;

        return tx.usingMachine.create({
          data: {
            machineUuid,
            userUuid: userUuid ?? null,
            notifyOnCompletion,
          },
        });
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `createUsingMachine prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`createUsingMachine error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  // Get only open sessions linked to a user
  async getUsingMachinesByUser(userUuid: string): Promise<UsingMachine[]> {
    return await this.databaseService.usingMachine
      .findMany({
        where: { userUuid, endedAt: null },
        orderBy: [{ startedAt: 'desc' }, { uuid: 'desc' }],
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `getUsingMachinesByUser prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`getUsingMachinesByUser error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  // Enable completion notification and link userUuid if non-member or matching user
  async enableMachineNotification(
    userUuid: string,
    machineUuid: string,
  ): Promise<number> {
    const result = await this.databaseService.usingMachine
      .updateMany({
        where: {
          machineUuid,
          endedAt: null,
          OR: [{ userUuid: null }, { userUuid: userUuid }],
        },
        data: {
          userUuid,
          notifyOnCompletion: true,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `enableMachineNotification prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`enableMachineNotification error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });

    return result.count;
  }

  // Disable completion notification for the operating user
  async disableMachineNotification(
    userUuid: string,
    machineUuid: string,
  ): Promise<number> {
    const result = await this.databaseService.usingMachine
      .updateMany({
        where: {
          machineUuid,
          endedAt: null,
          userUuid,
        },
        data: {
          notifyOnCompletion: false,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `disableMachineNotification prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`disableMachineNotification error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });

    return result.count;
  }

  // Get active usingMachine by machineUuid
  async getUsingMachineByMachineUuid(
    machineUuid: string,
  ): Promise<UsingMachine | null> {
    return await this.databaseService.usingMachine
      .findFirst({
        where: { machineUuid, endedAt: null },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `getUsingMachineByMachineUuid prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`getUsingMachineByMachineUuid error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  // Close and return the session atomically, retaining its user and timestamps.
  async finishUsingMachine(machineUuid: string): Promise<UsingMachine | null> {
    return this.databaseService
      .$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "uuid" FROM "machine"
          WHERE "uuid" = ${machineUuid}::uuid FOR UPDATE
        `;
        const finished = await tx.usingMachine.updateManyAndReturn({
          where: { machineUuid, endedAt: null },
          data: { endedAt: new Date() },
        });
        return finished[0] ?? null;
      })
      .catch((error) => {
        this.logger.error(`finishUsingMachine error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  async getUsageHistoryByUser(
    userUuid: string,
    limit: number,
    offset: number,
  ): Promise<UsingMachine[]> {
    return this.databaseService.usingMachine
      .findMany({
        where: { userUuid, endedAt: { not: null } },
        orderBy: [{ startedAt: 'desc' }, { uuid: 'desc' }],
        take: limit,
        skip: offset,
      })
      .catch((error) => {
        this.logger.error(`getUsageHistoryByUser error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  // Unlink user from usingMachine (set userUuid to null and disable notification)
  async unlinkUserFromUsingMachine(
    userUuid: string,
    machineUuid: string,
  ): Promise<number> {
    const result = await this.databaseService.usingMachine
      .updateMany({
        where: {
          machineUuid,
          endedAt: null,
          userUuid,
        },
        data: {
          userUuid: null,
          notifyOnCompletion: false,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `unlinkUserFromUsingMachine prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`unlinkUserFromUsingMachine error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });

    return result.count;
  }
}
