import { Gender, Location, MachineType } from 'generated/prisma/client';
import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GetLaundryRoomStatusResDto {
  @ApiProperty({
    description: 'Location (A or B)',
    enum: Location,
    example: Location.A,
  })
  @IsEnum(Location)
  location: Location;

  @ApiProperty({
    description: 'Machine Type (WASHER or DRYER)',
    enum: MachineType,
    example: MachineType.WASHER,
  })
  @IsEnum(MachineType)
  type: MachineType;

  @ApiProperty({
    description: 'Gender (MALE or FEMALE)',
    enum: Gender,
    example: Gender.MALE,
  })
  @IsEnum(Gender)
  gender: Gender;

  @ApiProperty({
    description: 'The number of unused machines in the laundry room',
  })
  unusedCount: number;
}
