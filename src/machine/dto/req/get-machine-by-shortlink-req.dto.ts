import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class GetMachineByShortlinkReqDto {
  @ApiProperty({
    description: 'Short code (the last path segment of the machine QR URL)',
    example: 'abc123',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/)
  shortCode: string;
}
