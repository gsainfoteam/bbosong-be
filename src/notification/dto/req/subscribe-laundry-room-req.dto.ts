import { Location, Gender, MachineType } from 'generated/prisma/client';
import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubscribeLaundryRoomReqDto {
  @ApiProperty({
    enum: Location,
    description: 'Laundry room location',
    example: Location.A,
  })
  @IsEnum(Location)
  location: Location;

  @ApiProperty({
    enum: Gender,
    description: 'Laundry room gender section',
    example: Gender.MALE,
  })
  @IsEnum(Gender)
  gender: Gender;

  @ApiProperty({
    enum: MachineType,
    description: 'Machine type to wait for',
    example: MachineType.WASHER,
  })
  @IsEnum(MachineType)
  type: MachineType;
}
