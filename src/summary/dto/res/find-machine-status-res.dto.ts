import { Gender, Location, MachineType } from 'generated/prisma/client';
import { IsEnum } from 'class-validator';

export class FindMachineStatusResDto {
  @IsEnum(Location)
  location: Location;
  @IsEnum(MachineType)
  type: MachineType;
  @IsEnum(Gender)
  gender: Gender;
  unusedCount: number;
}
