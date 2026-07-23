import { Gender, Location, MachineType } from 'generated/prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, Max, Min } from 'class-validator';
import { IsGreaterThan } from 'src/common/decorator/is-greater-than.decorator';

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
  @Min(1)
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
    description: 'End index',
    example: 1,
    required: true,
  })
  @IsNumber()
  @Max(30)
  @IsGreaterThan('startIndex')
  endIndex: number;
}
