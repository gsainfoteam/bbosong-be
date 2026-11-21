import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, Matches, MaxLength } from 'class-validator';
import { LiveActivityEnvironment } from 'generated/prisma/client';

// APNs device tokens are hex strings and are placed in the request path, so
// anything else must never reach the APNs client.
const APNS_TOKEN_PATTERN = /^[0-9a-fA-F]+$/;

export class RegisterLiveActivityReqDto {
  @ApiProperty({
    description:
      'Hex push token of the Live Activity (ActivityKit `pushTokenUpdates`). Re-send whenever it rotates.',
    example: '80a3c5d1e2f4b6a79081c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d',
  })
  @IsString()
  @MaxLength(512)
  @Matches(APNS_TOKEN_PATTERN, { message: 'pushToken must be a hex string' })
  pushToken: string;

  @ApiProperty({
    enum: LiveActivityEnvironment,
    enumName: 'LiveActivityEnvironment',
    description:
      'APNs environment the app build uses: SANDBOX for Debug builds, PRODUCTION for TestFlight and App Store.',
    example: LiveActivityEnvironment.PRODUCTION,
  })
  @IsEnum(LiveActivityEnvironment)
  environment: LiveActivityEnvironment;
}
