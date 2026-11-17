import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const NATIVE_PUSH_PLATFORMS = ['IOS', 'ANDROID'] as const;
export type NativePushPlatform = (typeof NATIVE_PUSH_PLATFORMS)[number];

export class RegisterNativePushReqDto {
  @ApiProperty({
    enum: NATIVE_PUSH_PLATFORMS,
    description:
      'Native platform of the device. iOS is delivered via FCM → APNs.',
    example: 'ANDROID',
  })
  @IsIn(NATIVE_PUSH_PLATFORMS)
  platform: NativePushPlatform;

  @ApiProperty({
    description: 'FCM registration token issued to the app installation',
    example: 'fcm-registration-token-example',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token: string;
}
