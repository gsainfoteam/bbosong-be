import { Loggable } from '@lib/logger';
import * as crypto from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { Gender, Prisma, Role, User } from 'generated/prisma/client';
import { PrismaTransaction } from '../types';
import { GenderRequiredException } from 'src/auth/exceptions/gender-required.exception';

@Loggable()
@Injectable()
export class UserRepository {
  private readonly logger = new Logger(UserRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async findUser(uuid: string): Promise<User> {
    return await this.databaseService.user
      .findFirstOrThrow({
        where: {
          uuid,
          deletedAt: null,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2025') {
            this.logger.debug(`user not found: ${uuid}`);
            throw new NotFoundException('User not found');
          }
          this.logger.error(`findUser prisma error: ${error.message}`);
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`findUser error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  async findUserByStudentNumberInTx(
    studentNumber: string,
    tx: PrismaTransaction,
  ): Promise<User | null> {
    return await tx.user.findUnique({
      where: {
        studentNumber,
      },
    });
  }

  async upsertUserInTx(
    {
      name,
      email,
      studentNumber,
    }: Pick<User, 'name' | 'email' | 'studentNumber'>,
    gender: Gender | undefined,
    existingUser: User | null,
    tx: PrismaTransaction,
  ): Promise<User> {
    if (!existingUser && !gender) throw new GenderRequiredException();
    const uuid = existingUser?.uuid ?? crypto.randomUUID();

    return await (
      existingUser
        ? tx.user.update({
            where: { uuid: existingUser.uuid },
            data: {
              name,
              email,
              studentNumber,
              gender,
            },
          })
        : tx.user.create({
            data: {
              uuid,
              name,
              email,
              studentNumber,
              gender: gender!,
            },
          })
    ).catch((error) => {
      if (error instanceof HttpException) {
        throw error;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          this.logger.debug(`Conflict studentHash: ${error.message}`);
          throw new ConflictException('Conflict Error');
        }
        this.logger.error(`upsertUserInTx prisma error: ${error.message}`);
        throw new InternalServerErrorException('Database Error');
      }
      this.logger.error(`upsertUserInTx error: ${error}`);
      throw new InternalServerErrorException('Unknown Error');
    });
  }

  async updateUserRole(userUuid: string, role: Role): Promise<User> {
    const result = await this.databaseService.user
      .updateMany({
        where: { uuid: userUuid, deletedAt: null },
        data: { role },
      })
      .catch((error) => {
        this.logger.error(`updateUserRole error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });

    if (result.count === 0) {
      this.logger.debug(`user not found or inactive: ${userUuid}`);
      throw new NotFoundException('User not found');
    }

    return await this.findUser(userUuid);
  }

  async deleteUserInTx(userUuid: string, tx: PrismaTransaction): Promise<void> {
    const result = await tx.user
      .updateMany({
        where: { uuid: userUuid, deletedAt: null },
        data: {
          deletedAt: new Date(),
          name: 'Deactivated User',
          email: `deleted_${userUuid}@bbosong.me`,
          studentNumber: `deleted_${userUuid}`,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(`deleteUserInTx prisma error: ${error.message}`);
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`deleteUserInTx error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });

    if (result.count === 0) {
      this.logger.debug(`user not found or already deleted: ${userUuid}`);
      throw new NotFoundException('User not found');
    }
  }
}
