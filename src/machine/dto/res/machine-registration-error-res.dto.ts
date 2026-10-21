import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MachineRegistrationErrorResDto {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({ example: 'Conflict' })
  error: string;

  @ApiProperty()
  message: string;

  @ApiProperty({
    enum: [
      'MACHINE_NOT_RUNNING',
      'MACHINE_ALREADY_REGISTERED',
      'MACHINE_COMPLETION_CONFIRMATION_REQUIRED',
      'MACHINE_USAGE_CHANGED',
    ],
  })
  errorCode: string;

  @ApiPropertyOptional({
    description:
      'Session to confirm; only present for MACHINE_COMPLETION_CONFIRMATION_REQUIRED',
    format: 'uuid',
  })
  usageUuid?: string;
}
