import { Location, Gender, MachineType } from 'generated/prisma/client';

export type LaundryRoomSummary = {
  location: Location;
  type: MachineType;
  gender: Gender;
  unusedCount: number;
};
