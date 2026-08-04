import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateMachineReqDto {
  @ApiProperty({
    description: 'Whether the machine is physically operable',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiProperty({
    description: 'X-axis position of the machine on the floor map',
    example: 10,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  posX?: number;

  @ApiProperty({
    description: 'Y-axis position of the machine on the floor map',
    example: 20,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  posY?: number;
}
