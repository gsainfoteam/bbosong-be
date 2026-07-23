import { Gender, Location, MachineType } from 'generated/prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, Min } from 'class-validator';

export class CreateMachineReqDto {
  @ApiProperty({
    description: 'Gender (MALE or FEMALE)',
    enum: Gender,
    example: Gender.MALE,
    required: true,
  })
  @IsEnum(Gender)
  gender: Gender;

  @ApiProperty({
    description: 'Location (A or B)',
    enum: Location,
    example: Location.A,
    required: true,
  })
  @IsEnum(Location)
  location: Location;

  @ApiProperty({
    description: 'Machine type (WASHER or DRYER)',
    enum: MachineType,
    example: MachineType.WASHER,
    required: true,
  })
  @IsEnum(MachineType)
  type: MachineType;

  @ApiProperty({
    description: 'Machine index',
    example: 1,
    required: true,
  })
  @IsInt()
  index: number;
}

export class CreateMultipleMachinesReqDto {
  @ApiProperty({
    description: 'Gender (MALE or FEMALE)',
    enum: Gender,
    example: Gender.MALE,
    required: true,
  })
  @IsEnum(Gender)
  gender: Gender;

  @ApiProperty({
    description: 'Location (A or B)',
    enum: Location,
    example: Location.A,
    required: true,
  })
  @IsEnum(Location)
  location: Location;

  @ApiProperty({
    description: 'Machine type (WASHER or DRYER)',
    enum: MachineType,
    example: MachineType.WASHER,
    required: true,
  })
  @IsEnum(MachineType)
  type: MachineType;

  @ApiProperty({
    description: 'Start index',
    example: 1,
    required: true,
  })
  @IsNumber()
  @Min(1)
  startIndex: number;

  @ApiProperty({
    description: 'Start index',
    example: 1,
    required: true,
  })
  @IsNumber()
  endIndex: number;
}
