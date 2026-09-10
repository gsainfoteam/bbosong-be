import { ApiProperty } from '@nestjs/swagger';
import { Gender, Location, MachineType } from 'generated/prisma/client';

export class GetLaundryRoomSubscriptionResDto {
  @ApiProperty({
    description: 'Unique UUID of the subscription record',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  uuid: string;

  @ApiProperty({
    description: 'UUID of the subscribing user',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  userUuid: string;

  @ApiProperty({
    description: 'Laundry room location',
    enum: Location,
    example: Location.A,
  })
  location: Location;

  @ApiProperty({
    description: 'Laundry room gender section',
    enum: Gender,
    example: Gender.MALE,
  })
  gender: Gender;

  @ApiProperty({
    description: 'Machine type to wait for',
    enum: MachineType,
    example: MachineType.WASHER,
  })
  type: MachineType;

  @ApiProperty({
    description: 'Time when the subscription was created',
    example: '2026-09-10T09:00:00.000Z',
  })
  createdAt: Date;
}
