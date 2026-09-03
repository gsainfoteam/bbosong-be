import { ApiProperty } from '@nestjs/swagger';

export class GenderRequiredErrorDto {
  @ApiProperty({
    description: 'Error message',
    example: 'Gender input is required for first-time login.',
  })
  message: string;

  @ApiProperty({
    description: 'Error code',
    example: 'GENDER_REQUIRED',
    enum: ['GENDER_REQUIRED'],
  })
  errorCode: string;

  @ApiProperty({
    description: 'HTTP status code',
    example: 403,
  })
  statusCode: number;
}
