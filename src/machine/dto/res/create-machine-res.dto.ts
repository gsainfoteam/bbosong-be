import { ApiProperty } from '@nestjs/swagger';

export class CreateMachineResDto {
  @ApiProperty({
    description: 'The UUID of the newly created machine',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  uuid: string;
}

export class CreateMultipleMachinesResDto {
  @ApiProperty({
    type: [String],
    description:
      'The list of unique UUIDs for the created machines in the requested order',
  })
  uuids: string[];
}
