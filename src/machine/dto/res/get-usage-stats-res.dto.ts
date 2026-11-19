import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, Location } from 'generated/prisma/client';

export class GetUsageStatsResDto {
  @ApiPropertyOptional({
    example: '2026-11-10',
    description: 'KST calendar date. Present when grouped by date.',
  })
  date?: string;

  @ApiPropertyOptional({
    example: 1,
    description:
      'ISO weekday in KST (1=Mon … 7=Sun). Present when grouped by weekday.',
  })
  weekday?: number;

  @ApiPropertyOptional({
    example: 14,
    description:
      'KST hour of day (0-23) the session started. Present when grouped by hour.',
  })
  hour?: number;

  @ApiPropertyOptional({
    enum: Location,
    description: 'Present when grouped by location.',
  })
  location?: Location;

  @ApiPropertyOptional({
    enum: Gender,
    description: 'Laundry room gender. Present when grouped by gender.',
  })
  gender?: Gender;

  @ApiProperty({ example: 42, description: 'Number of qualifying sessions' })
  sessionCount: number;
}
