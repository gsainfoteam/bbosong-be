import { ApiProperty } from '@nestjs/swagger';
import type { MachineConnectivity } from '../../machine-connectivity.service';
import {
  Gender,
  Location,
  Machine,
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
    enum: MachineStatus,
    example: MachineStatus.IDLE,
  })
  status: MachineStatus;

  @ApiProperty({
    description: 'Shlink URL for the machine registration page',
    example: 'https://s.example.com/123e4567-e89b-12d3-a456-426614174000',
    nullable: true,
  })
  shortUrl: string | null;

  @ApiProperty({
    description: 'Unique short code of the machine QR link',
    nullable: true,
    example: 'abc123',
  })
  shortCode: string | null;

  @ApiProperty({
    description:
      'Matter connectivity: true online, false offline after 60 seconds unavailable, null for ThinQ devices, uncommissioned devices or pending first check',
    type: Boolean,
    nullable: true,
  })
  isOnline: boolean | null;

  @ApiProperty({
    description:
      'Last time Matter Server confirmed the device reachable; kept in memory and reset on backend restart',
    type: String,
    format: 'date-time',
    nullable: true,
  })
  lastSeenAt: Date | null;

  @ApiProperty({ description: 'Mapped ThinQ device ID', nullable: true })
  thinqDeviceId: string | null;

  @ApiProperty({
    description: 'Last ThinQ runState.currentState',
    nullable: true,
  })
  thinqCurrentState: string | null;

  @ApiProperty({
    description: 'Remaining drying time in minutes, when supplied by ThinQ',
    nullable: true,
  })
  thinqRemainingMinutes: number | null;

  @ApiProperty({
    description: 'Last successful ThinQ state query',
    type: String,
    format: 'date-time',
    nullable: true,
  })
  thinqUpdatedAt: Date | null;

  constructor(machine: Machine, connectivity: MachineConnectivity) {
    this.uuid = machine.uuid;
    this.type = machine.type;
    this.location = machine.location;
    this.gender = machine.gender;
    this.index = machine.index;
    this.isAvailable = machine.isAvailable;
    this.posX = machine.posX;
    this.posY = machine.posY;
    this.status = machine.status;
    this.shortUrl = machine.shortUrl;
    this.shortCode = machine.shortCode;
    this.isOnline = connectivity.isOnline;
    this.lastSeenAt = connectivity.lastSeenAt;
    this.thinqDeviceId = machine.thinqDeviceId;
    this.thinqCurrentState = machine.thinqCurrentState;
    this.thinqRemainingMinutes = machine.thinqRemainingMinutes;
    this.thinqUpdatedAt = machine.thinqUpdatedAt;
  }
}
