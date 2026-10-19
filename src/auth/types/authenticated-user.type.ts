import { User } from 'generated/prisma/client';

export type AuthenticatedUser = User & { sessionId: string };
