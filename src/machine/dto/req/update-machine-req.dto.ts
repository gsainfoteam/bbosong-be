import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsNotEmpty,
} from 'class-validator';

export class UpdateMachineReqDto {
  @ApiPropertyOptional({
    description: 'Whether the machine is physically operable',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({
    description: 'X-axis position of the machine on the floor map',
    example: 10,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  posX?: number;

  @ApiPropertyOptional({
    description: 'Y-axis position of the machine on the floor map',
    example: 20,
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  posY?: number;

  @ApiPropertyOptional({
    description: 'Machine Matter Payload',
    example: 'MT:1234567890',
    required: false,
  })
  @IsOptional()
  @IsString()
  matterPayload?: string;

  @ApiPropertyOptional({
    description: 'ThinQ device ID (dryers only); null removes the mapping',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  thinqDeviceId?: string | null;
}
