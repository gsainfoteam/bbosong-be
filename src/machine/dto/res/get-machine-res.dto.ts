import { ApiProperty } from '@nestjs/swagger';
import {
  Gender,
  Location,
  MachineStatus,
  MachineType,
} from 'generated/prisma/client';

export class GetMachineResDto {
  @ApiProperty({
    description: 'Unique UUID of the machine',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  uuid: string;

  @ApiProperty({
    description: 'Machine type (WASHER or DRYER)',
    enum: MachineType,
    example: MachineType.WASHER,
  })
  type: MachineType;

  @ApiProperty({
    description: 'Location (A or B)',
    enum: Location,
    example: Location.A,
  })
  location: Location;

  @ApiProperty({
    description: 'Gender (MALE or FEMALE)',
    enum: Gender,
    example: Gender.MALE,
  })
  gender: Gender;

  @ApiProperty({
    description: 'Machine index number',
    example: 1,
  })
  index: number;

  @ApiProperty({
    description: 'Availability status of the machine',
    example: true,
  })
  isAvailable: boolean;

  @ApiProperty({
    description: 'X-axis position on floor map',
    example: 10,
    nullable: true,
  })
  posX: number | null;

  @ApiProperty({
    description: 'Y-axis position on floor map',
    example: 20,
    nullable: true,
  })
  posY: number | null;

  @ApiProperty({
    description: 'Current status of the machine',
    example: MachineStatus.IDLE,
  })
  status: MachineStatus;
}
