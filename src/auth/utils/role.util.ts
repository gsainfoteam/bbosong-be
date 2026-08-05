import { Role } from 'generated/prisma/client';

export const isAdminRole = (role: Role): boolean => {
  return role === Role.ADMIN;
};
