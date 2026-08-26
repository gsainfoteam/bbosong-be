import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreatePowerReqDto {
  @ApiProperty({
    description: 'Power value to record',
    example: 1200,
    minimum: 0,
  })
  @IsDefined()
  @IsNotEmpty()
  @Transform(({ value }) =>
    value === null || value === '' ? Number.NaN : Number(value),
  )
  @IsNumber()
  @Min(0)
  power: number;
}
