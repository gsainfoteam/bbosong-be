import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class UnregisterPushReqDto {
  @ApiProperty({
    description: 'Push service endpoint URL of the subscription to remove',
    example: 'https://fcm.googleapis.com/fcm/send/dGVzdC1lbmRwb2ludC1leGFtcGxl',
  })
  @IsString()
  @IsNotEmpty()
  endpoint: string;
}
