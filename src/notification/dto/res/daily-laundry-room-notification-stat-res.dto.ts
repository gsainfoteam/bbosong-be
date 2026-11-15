import { ApiProperty } from '@nestjs/swagger';

export class DailyLaundryRoomNotificationStatResDto {
  @ApiProperty({ description: 'KST calendar day', example: '2026-11-10' })
  date: string;

  @ApiProperty({
    description: 'Successful availability-notification requests that day',
  })
  subscriptionCount: number;

  @ApiProperty({ description: 'Distinct users who requested that day' })
  subscriptionUserCount: number;

  @ApiProperty({
    description: 'Availability notifications successfully sent that day',
  })
  notificationCount: number;

  @ApiProperty({ description: 'Distinct users notified that day' })
  notificationUserCount: number;
}
