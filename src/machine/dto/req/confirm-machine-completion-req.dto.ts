import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ConfirmMachineCompletionReqDto {
  @ApiProperty({
    description:
      'usageUuid returned by MACHINE_COMPLETION_CONFIRMATION_REQUIRED',
    format: 'uuid',
  })
  @IsUUID()
  usageUuid: string;
}
