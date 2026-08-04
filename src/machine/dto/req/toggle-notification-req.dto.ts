import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ToggleNotificationReqDto {
  @ApiProperty({
    description: 'Whether to receive machine completion notification',
    example: true,
  })
  @IsBoolean()
  notifyOnCompletion: boolean;
}
