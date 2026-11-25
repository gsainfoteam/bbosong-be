import { ApiProperty } from '@nestjs/swagger';

export class SetRemainingTimeResDto {
  @ApiProperty({
    description:
      'Estimated finish time of the session (server now + remainingMinutes)',
    example: '2026-08-01T15:00:00.000Z',
    type: String,
    format: 'date-time',
  })
  estimatedEndsAt: Date;
}
