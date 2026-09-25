import { ApiProperty } from '@nestjs/swagger';
import { GetMachineResDto } from './get-machine-res.dto';
import { MachineWithUsage } from '@lib/database/types/machine.type';
import { UsingMachine } from 'generated/prisma/browser';

export class MachineUsageInfoDto {
  @ApiProperty({
    description: 'Unique UUID of the usage record',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  uuid: string;

  @ApiProperty({
    description: 'UUID of the user currently operating the machine',
    example: '123e4567-e89b-12d3-a456-426614174000',
    nullable: true,
  })
  userUuid: string | null;

  @ApiProperty({
    description: 'Whether completion notification is enabled for this usage',
    example: true,
  })
  notifyOnCompletion: boolean;

  @ApiProperty({
    description: 'Timestamp when the machine usage started',
    example: '2026-08-01T14:23:11.000Z',
  })
  startedAt: Date;

  @ApiProperty({
    description: 'Expected duration of the usage in minutes',
    example: 40,
  })
  durationMinutes: number;

  constructor(usage: UsingMachine) {
    this.uuid = usage.uuid;
    this.userUuid = usage.userUuid;
    this.notifyOnCompletion = usage.notifyOnCompletion;
    this.startedAt = usage.startedAt;
    this.durationMinutes = usage.durationMinutes;
  }
}

export class GetMachineDetailResDto extends GetMachineResDto {
  @ApiProperty({
    description: 'Current usage session of the machine, if any',
    type: MachineUsageInfoDto,
    nullable: true,
  })
  currentUsage: MachineUsageInfoDto | null;

  constructor(machine: MachineWithUsage) {
    super(machine);
    this.currentUsage = machine.currentUsage
      ? new MachineUsageInfoDto(machine.currentUsage)
      : null;
  }
}
