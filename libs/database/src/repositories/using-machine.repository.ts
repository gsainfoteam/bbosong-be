import { Loggable } from '@lib/logger';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { DatabaseService } from '@lib/database/database.service';
import { Prisma, UsingMachine } from 'generated/prisma/client';

@Loggable()
@Injectable()
export class UsingMachineRepository {
  private readonly logger = new Logger(UsingMachineRepository.name);
  constructor(private readonly databaseService: DatabaseService) {}

  // Create or start using a machine
  async createUsingMachine(
    machineUuid: string,
    durationMinutes: number,
    userUuid?: string,
    notifyOnCompletion = true,
  ): Promise<UsingMachine> {
    return await this.databaseService.usingMachine
      .upsert({
        where: { machineUuid },
        create: {
          machineUuid,
          userUuid: userUuid ?? null,
          durationMinutes,
          notifyOnCompletion,
        },
        update: {
          userUuid: userUuid ?? null,
          durationMinutes,
          notifyOnCompletion,
          startedAt: new Date(),
        },
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

  // Get all machine usage records linked to a user
  async getUsingMachinesByUser(userUuid: string): Promise<UsingMachine[]> {
    return await this.databaseService.usingMachine
      .findMany({
        where: { userUuid },
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
      .findUnique({
        where: { machineUuid },
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

  // Delete usingMachine record when run completes or is canceled
  async deleteUsingMachine(machineUuid: string): Promise<number> {
    const result = await this.databaseService.usingMachine
      .deleteMany({
        where: { machineUuid },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `deleteUsingMachine prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`deleteUsingMachine error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });

    return result.count;
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
