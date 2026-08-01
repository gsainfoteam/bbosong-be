import { IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePowerReqDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  power: number;
}
