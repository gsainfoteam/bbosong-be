import { ApiProperty } from '@nestjs/swagger';
import type { UsingMachineWithThinq } from '@lib/database/types/machine.type';

export class GetUsingMachineResDto {
  @ApiProperty({
    description: 'Unique UUID of the usage record',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  uuid: string;

  @ApiProperty({
    description: 'UUID of the machine being used',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  machineUuid: string;

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
    description:
      'Timestamp when usage ended; null while running. Equals startedAt for zero-duration completion confirmed by another user.',
    example: '2026-08-01T15:23:11.000Z',
    nullable: true,
  })
  endedAt: Date | null;

  @ApiProperty({
    description:
      'Estimated finish time entered by the operating user (washers only); null when not entered',
    example: '2026-08-01T15:00:00.000Z',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  estimatedEndsAt: Date | null;
}

export class GetActiveUsingMachineResDto extends GetUsingMachineResDto {
  @ApiProperty({
    description:
      'Remaining minutes from the machine ThinQ timer as of thinqUpdatedAt; null when unavailable (e.g. not a ThinQ machine or still detecting)',
    example: 20,
    nullable: true,
    type: Number,
  })
  remainingMinutes: number | null;

  @ApiProperty({
    description:
      'Time the ThinQ state (and remainingMinutes) was last updated. Estimated end time = thinqUpdatedAt + remainingMinutes',
    example: '2026-08-01T14:50:00.000Z',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  thinqUpdatedAt: Date | null;

  constructor(usage: UsingMachineWithThinq) {
    super();
    this.uuid = usage.uuid;
    this.machineUuid = usage.machineUuid;
    this.userUuid = usage.userUuid;
    this.notifyOnCompletion = usage.notifyOnCompletion;
    this.startedAt = usage.startedAt;
    this.endedAt = usage.endedAt;
    this.estimatedEndsAt = usage.estimatedEndsAt;
    this.remainingMinutes = usage.thinqRemainingMinutes;
    this.thinqUpdatedAt = usage.thinqUpdatedAt;
  }
}
