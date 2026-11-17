import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UnregisterNativePushReqDto {
  @ApiProperty({
    description: 'FCM registration token of the device to remove',
    example: 'fcm-registration-token-example',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token: string;
}
