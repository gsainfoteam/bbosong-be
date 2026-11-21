import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class UnregisterLiveActivityReqDto {
  @ApiProperty({
    description: 'Hex push token of the Live Activity to stop updating',
    example: '80a3c5d1e2f4b6a79081c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d',
  })
  @IsString()
  @MaxLength(512)
  @Matches(/^[0-9a-fA-F]+$/, { message: 'pushToken must be a hex string' })
  pushToken: string;
}
