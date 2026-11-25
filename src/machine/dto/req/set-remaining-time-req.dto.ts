import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export const MAX_REMAINING_MINUTES = 180;

export class SetRemainingTimeReqDto {
  @ApiProperty({
    description:
      'Remaining minutes shown on the washer display. The server converts it to estimatedEndsAt using its own clock.',
    example: 37,
    minimum: 1,
    maximum: MAX_REMAINING_MINUTES,
  })
  @IsInt()
  @Min(1)
  @Max(MAX_REMAINING_MINUTES)
  remainingMinutes: number;
}
