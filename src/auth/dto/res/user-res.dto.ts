import { ApiProperty } from '@nestjs/swagger';
import { Gender, Role } from 'generated/prisma/client';

export class UserResDto {
  @ApiProperty({
    description: 'The unique UUID of the user',
  })
  uuid: string;

  @ApiProperty({
    description: 'The name of the user',
  })
  name: string;

  @ApiProperty({
    description: 'The email address of the user',
  })
  email: string;

  @ApiProperty({
    description: 'The student ID number of the user',
  })
  studentNumber: string;

  @ApiProperty({
    enum: Gender,
    description: 'The gender division of the user',
  })
  gender: Gender;

  @ApiProperty({
    enum: Role,
    description: 'The system authorization role of the user',
  })
  role: Role;
}
