import { ApiProperty } from '@nestjs/swagger';

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
    description: 'Expected duration of the usage in minutes',
    example: 40,
  })
  durationMinutes: number;
}
