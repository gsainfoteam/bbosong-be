import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional } from 'class-validator';

export class GetMachinePowerReqDto {
  @ApiPropertyOptional({
    description:
      'Start of the time range. If provided, all records recorded at or after this time are returned. Defaults to the last 1 hour.',
    example: '2026-08-01T14:23:11.000Z',
    type: String,
    format: 'date-time',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startedAt?: Date;
}
