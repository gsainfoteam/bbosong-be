import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

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

  @ApiProperty({
    required: false,
    default: false,
    description:
      'Set true when this Android app renders Android 16 Live Update notifications from FCM data-only messages (`type: LIVE_UPDATE`). The server then skips the regular machine completion/error alert push for this device to avoid duplicate notifications. Ignored for iOS. Stored per token: re-registering without it resets it to false.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  supportsLiveUpdate?: boolean;
}
