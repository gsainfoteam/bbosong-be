import { ApiProperty } from '@nestjs/swagger';

export class GetDailySessionStatsResDto {
  @ApiProperty({ example: '2026-11-10', description: 'KST calendar date' })
  date: string;

  @ApiProperty({ example: 12 })
  registeredCount: number;

  @ApiProperty({ example: 34 })
  unregisteredCount: number;
}
