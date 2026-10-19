import {
  Location,
  Gender,
  MachineType,
  Machine,
  UsingMachine,
} from 'generated/prisma/client';

export type LaundryRoomSummary = {
  location: Location;
  type: MachineType;
  gender: Gender;
  unusedCount: number;
};

export type MachineWithUsage = Machine & {
  currentUsage: UsingMachine | null;
};
