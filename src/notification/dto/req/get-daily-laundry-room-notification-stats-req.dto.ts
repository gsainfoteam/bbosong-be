import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class GetDailyLaundryRoomNotificationStatsReqDto {
  @ApiProperty({
    description: 'Inclusive KST start date (YYYY-MM-DD)',
    example: '2026-11-01',
  })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  from: string;

  @ApiProperty({
    description: 'Inclusive KST end date (YYYY-MM-DD)',
    example: '2026-11-15',
  })
  @Matches(DATE_ONLY)
  @IsDateString({ strict: true })
  to: string;
}
