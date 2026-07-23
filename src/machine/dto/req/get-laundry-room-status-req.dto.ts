import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { Gender } from 'generated/prisma/client';

export class GetLaundryRoomStatusReqDto {
  @ApiProperty({
    enum: Gender,
    description: 'Gender (MALE or FEMALE)',
    example: Gender.MALE,
    required: true,
  })
  @IsEnum(Gender)
  gender: Gender;
}
