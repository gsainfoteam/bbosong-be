import {
  Location,
  Gender,
  MachineType,
  Prisma,
} from 'generated/prisma/client';

export type LaundryRoomSummary = {
  location: Location;
  type: MachineType;
  gender: Gender;
  unusedCount: number;
};

const machineWithUsageArgs = {
  include: { currentUsage: true },
} satisfies Prisma.MachineDefaultArgs;

export type MachineWithUsage = Prisma.MachineGetPayload<
  typeof machineWithUsageArgs
>;
