import { ApiProperty } from '@nestjs/swagger';

export class SuccessResDto {
  @ApiProperty({
    description: 'Whether the request was processed successfully',
    example: true,
  })
  success: boolean;
}
