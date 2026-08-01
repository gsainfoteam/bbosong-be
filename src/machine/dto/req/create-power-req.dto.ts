import { IsDefined, IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreatePowerReqDto {
  @IsDefined()
  @IsNotEmpty()
  @Transform(({ value }) =>
    value === null || value === '' ? NaN : Number(value),
  )
  @IsNumber()
  @Min(0)
  power: number;
}
