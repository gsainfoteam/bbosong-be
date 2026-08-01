import { ApiProperty } from '@nestjs/swagger';

export class GetMachinePowerResDto {
  @ApiProperty({
    description: 'Unique UUID of the power record',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  uuid: string;

  @ApiProperty({
    description: 'Machine UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  machineUuid: string;

  @ApiProperty({
    description: 'Measured power value',
    example: 1250.5,
  })
  power: number;

  @ApiProperty({
    description: 'Timestamp when the power measurement was recorded',
    example: '2026-08-01T14:23:11.000Z',
  })
  recordedAt: Date;
}
