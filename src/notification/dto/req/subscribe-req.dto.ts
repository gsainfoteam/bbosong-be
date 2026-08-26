import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsObject,
  ValidateNested,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

class PushSubscriptionKeysDto {
  @ApiProperty({
    description: 'Public key used to encrypt push messages (P-256 ECDH)',
    example:
      'BIPUL12DLfytvTajnryr2PRdAgXS3HGKiLqndGcJGabyhIfLfnFVwtiRlnqYD03qMzPTgy2M...',
  })
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @ApiProperty({
    description: 'Authentication secret used to encrypt push messages',
    example: 'FPssNDTKnInHVndSTdbKFw',
  })
  @IsString()
  @IsNotEmpty()
  auth: string;
}

export class SubscribeReqDto {
  @ApiProperty({
    description: 'Push service endpoint URL for the subscribed client',
    example: 'https://fcm.googleapis.com/fcm/send/dGVzdC1lbmRwb2ludC1leGFtcGxl',
  })
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @ApiProperty({
    description: 'Encryption keys for the push subscription',
    type: PushSubscriptionKeysDto,
  })
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys: PushSubscriptionKeysDto;
}
