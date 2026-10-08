import { ApiProperty } from '@nestjs/swagger';

export class CreateMachineResDto {
  @ApiProperty({
    description: 'The UUID of the newly created machine',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  uuid: string;

  @ApiProperty({
    description: 'Shlink short URL that opens the machine registration page',
    example: 'https://s.example.com/123e4567-e89b-12d3-a456-426614174000',
  })
  shortUrl: string;
}

export class CreateMultipleMachinesResDto {
  @ApiProperty({
    type: [String],
    description:
      'The list of unique UUIDs for the created machines in the requested order',
  })
  uuids: string[];

  @ApiProperty({
    type: [String],
    description: 'Shlink URLs in the same order as uuids',
  })
  shortUrls: string[];
}

export class BackfillMachineLinksResDto {
  @ApiProperty({ description: 'Number of machine links created' })
  created: number;

  @ApiProperty({
    type: [String],
    description: 'Machine UUIDs whose links could not be created',
  })
  failedUuids: string[];
}
