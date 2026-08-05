import { Role } from 'generated/prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export class UpdateRoleReqDto {
  @ApiProperty({
    description: 'UUID of the target user',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  targetUserUuid: string;

  @ApiProperty({
    description: 'Role to be changed',
    example: Role.USER,
  })
  @IsEnum(Role)
  targetRole: Role;
}
