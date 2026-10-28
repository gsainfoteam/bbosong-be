import { Loggable } from '@lib/logger';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '@lib/database/database.service';
import {
  Gender,
  Machine,
  MachinePower,
  MachineStatus,
  MachineType,
  Prisma,
} from 'generated/prisma/client';
import {
  LaundryRoomSummary,
  MachineWithUsage,
} from '@lib/database/types/machine.type';
import {
  CreateMachineReqDto,
  CreateMultipleMachinesReqDto,
} from 'src/machine/dto/req/create-machine-req.dto';
import { Trace } from '@gsainfoteam/nest-observability';

const MACHINE_POWER_QUERY_MAX_COUNT = 5000;

@Loggable()
@Injectable()
@Trace()
export class MachineRepository {
  private readonly logger = new Logger(MachineRepository.name);
  constructor(private readonly databaseService: DatabaseService) {}

  async getLaundryRoomStatusByRoom(
    gender: Gender,
  ): Promise<LaundryRoomSummary[]> {
    const unusedGroups = await this.databaseService.machine
      .groupBy({
        by: ['location', 'gender', 'type'],
        where: {
          deletedAt: null,
          gender: gender,
          isAvailable: true,
          usages: {
            none: { endedAt: null },
          },
        },
        _count: {
          uuid: true,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          this.logger.error(
            `getLaundryRoomStatusByRoom prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`getLaundryRoomStatusByRoom error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });

    return unusedGroups.map((group) => ({
      location: group.location,
      gender: group.gender,
      type: group.type,
      unusedCount: group._count.uuid,
    }));
  }

  async createMachine(data: CreateMachineReqDto): Promise<Machine> {
    if (data.thinqDeviceId && data.type !== MachineType.DRYER) {
      throw new BadRequestException(
        'ThinQ mapping is only supported for dryers.',
      );
    }
    return this.databaseService.machine
      .create({
        data: {
          ...data,
          isCommissioned: data.matterPayload ? false : undefined,
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2002') {
            throw new ConflictException('Machine already exists.');
          }
          this.logger.error(`createMachine prisma error: ${error.message}`);
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`createMachine error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  async createMultipleMachines(
    data: CreateMultipleMachinesReqDto,
  ): Promise<Machine[]> {
    const itemCount = data.endIndex - data.startIndex + 1;

    const machines = await this.databaseService
      .$transaction(async (tx) => {
        const created = await tx.machine.createManyAndReturn({
          data: Array.from({ length: itemCount }, (_, i) => {
            const currentIndex = data.startIndex + i;

            return {
              uuid: crypto.randomUUID(),
              type: data.type,
              location: data.location,
              gender: data.gender,
              index: currentIndex,
            };
          }),
        });

        return created;
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2002') {
            throw new ConflictException('Machine already exists.');
          }
          this.logger.error(
            `createMultipleMachines prisma error: ${error.message}`,
          );
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`createMultipleMachines error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });

    return machines.sort((a, b) => a.index - b.index);
  }

  async getMachines(): Promise<Machine[]> {
    return await this.databaseService.machine
      .findMany({
        where: { deletedAt: null },
        orderBy: [
          { location: 'asc' },
          { gender: 'asc' },
          { type: 'asc' },
          { index: 'asc' },
        ],
      })
      .catch((error) => {
        this.logger.error(`getMachines error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  async getMachine(uuid: string): Promise<Machine | null> {
    return await this.databaseService.machine
      .findUnique({
        where: { uuid, deletedAt: null },
      })
      .catch((error) => {
        this.logger.error(`getMachine error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  async updateMachineShortUrl(
    uuid: string,
    shortUrl: string,
    shortCode: string,
  ): Promise<Machine> {
    return await this.databaseService.machine.update({
      where: { uuid, deletedAt: null },
      data: { shortUrl, shortCode },
    });
  }

  async getMachineWithUsageByShortCode(
    shortCode: string,
  ): Promise<MachineWithUsage | null> {
    return await this.databaseService.machine
      .findUnique({
        where: { shortCode, deletedAt: null },
        include: { usages: { where: { endedAt: null }, take: 1 } },
      })
      .then((machine) => {
        if (!machine) return null;
        const { usages, ...details } = machine;
        return { ...details, currentUsage: usages[0] ?? null };
      })
      .catch((error) => {
        this.logger.error(`getMachineWithUsageByShortCode error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  async getMachineWithUsage(uuid: string): Promise<MachineWithUsage | null> {
    return await this.databaseService.machine
      .findUnique({
        where: { uuid, deletedAt: null },
        include: { usages: { where: { endedAt: null }, take: 1 } },
      })
      .then((machine) => {
        if (!machine) return null;
        const { usages, ...details } = machine;
        return { ...details, currentUsage: usages[0] ?? null };
      })
      .catch((error) => {
        this.logger.error(`getMachineWithUsage error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  async updateMachine(
    uuid: string,
    isAvailable?: boolean,
    posX?: number,
    posY?: number,
    matterPayload?: string,
    thinqDeviceId?: string | null,
  ) {
    const machine = await this.databaseService.machine.findUnique({
      where: { uuid, deletedAt: null },
    });
    if (!machine) {
      throw new NotFoundException('Machine not found.');
    }

    if (thinqDeviceId && machine.type !== MachineType.DRYER) {
      throw new BadRequestException(
        'ThinQ mapping is only supported for dryers.',
      );
    }

    if (machine.matterPayload && (matterPayload || matterPayload === '')) {
      throw new BadRequestException(
        'Cannot change matter payload after it is set.',
      );
    }

    return await this.databaseService.machine
      .update({
        where: {
          uuid,
          deletedAt: null,
          ...(matterPayload ? { matterPayload: null } : {}),
        },
        data: {
          isAvailable,
          posX,
          posY,
          thinqDeviceId,
          ...(thinqDeviceId !== undefined &&
          thinqDeviceId !== machine.thinqDeviceId
            ? {
                thinqCurrentState: null,
                thinqRemainingMinutes: null,
                thinqUpdatedAt: null,
              }
            : {}),
          ...(matterPayload ? { matterPayload, isCommissioned: false } : {}),
        },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2002') {
            throw new ConflictException('ThinQ device is already mapped.');
          }
          if (error.code === 'P2025') {
            throw new NotFoundException('Machine not found.');
          }
          this.logger.error(`updateMachine prisma error: ${error.message}`);
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`updateMachine error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  async deleteMachine(uuid: string): Promise<void> {
    await this.databaseService.machine
      .update({
        where: { uuid, deletedAt: null },
        data: { deletedAt: new Date() },
      })
      .catch((error) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === 'P2025') {
            throw new NotFoundException('Machine not found.');
          }
          this.logger.error(`deleteMachine prisma error: ${error.message}`);
          throw new InternalServerErrorException('Database Error');
        }
        this.logger.error(`deleteMachine error: ${error}`);
        throw new InternalServerErrorException('Unknown Error');
      });
  }

  async recordMachinePower(uuid: string, power: number): Promise<void> {
    await this.databaseService.machinePower
      .create({
        data: {
          power,
          machine: { connect: { uuid, deletedAt: null } },
        },
      })
      .catch((error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2025'
        ) {
          throw new NotFoundException('Machine not found.');
        }
        this.logger.error(`recordMachinePower error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  async recordMachinePowerByMacAddress(
    macAddress: string,
    power: number,
  ): Promise<void> {
    const machine = await this.databaseService.machine
      .findFirst({
        where: { macAddress, deletedAt: null },
        select: { uuid: true },
      })
      .catch((error) => {
        this.logger.error(`recordMachinePowerByMacAddress error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
    if (!machine) throw new NotFoundException('Machine not found.');
    await this.recordMachinePower(machine.uuid, power);
  }

  async getMachineTypeByMacAddress(
    macAddress: string,
  ): Promise<MachineType | null> {
    return this.databaseService.machine
      .findFirst({
        where: { macAddress, deletedAt: null },
        select: { type: true },
      })
      .then((machine) => machine?.type ?? null)
      .catch((error) => {
        this.logger.error(`getMachineTypeByMacAddress error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  async updateMachineStatusByMacAddress(
    macAddress: string,
    status: MachineStatus,
  ): Promise<void> {
    await this.databaseService.machine
      .updateMany({
        where: { macAddress, deletedAt: null, status: { not: status } },
        data: { status },
      })
      .catch((error) => {
        this.logger.error(`updateMachineStatusByMacAddress error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  async updateThinqDryerState(
    uuid: string,
    thinqDeviceId: string,
    thinqCurrentState: string | null,
    thinqRemainingMinutes: number | null,
    status: MachineStatus | null,
  ): Promise<number> {
    const result = await this.databaseService.machine.updateMany({
      where: { uuid, deletedAt: null, type: MachineType.DRYER, thinqDeviceId },
      data: {
        thinqCurrentState,
        thinqRemainingMinutes,
        thinqUpdatedAt: new Date(),
        ...(status ? { status } : {}),
      },
    });
    return result.count;
  }

  async getMachinePowerFrom(
    uuid: string,
    from?: Date,
  ): Promise<MachinePower[]> {
    const startedAt = from ?? new Date(Date.now() - 60 * 60 * 1000);

    return await this.databaseService.machinePower
      .findMany({
        where: {
          machineUuid: uuid,
          machine: { deletedAt: null },
          recordedAt: {
            gte: startedAt,
          },
        },
        orderBy: {
          recordedAt: 'asc',
        },
        take: MACHINE_POWER_QUERY_MAX_COUNT,
      })
      .catch((error) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        ) {
          throw new NotFoundException('Machine not found.');
        }
        this.logger.error(`getMachinePowerFrom error: ${error}`);
        throw new InternalServerErrorException('Database Error');
      });
  }

  async updateMachineCommissioned(
    uuid: string,
    macAddress: string,
  ): Promise<void> {
    await this.databaseService.machine.update({
      where: { uuid, deletedAt: null },
      data: { macAddress, isCommissioned: true },
    });
  }

  async resetMachineCommissioned(uuid: string): Promise<void> {
    await this.databaseService.machine.update({
      where: { uuid, deletedAt: null },
      data: { isCommissioned: false },
    });
  }
}
