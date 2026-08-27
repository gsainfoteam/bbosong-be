/**
 * One-off bootstrap: promote a single user to Role.ADMIN.
 *
 * The app has no seed data and `POST /auth/role` is guarded by AdminGuard,
 * so when no admin exists yet, there's no in-app way to create the first
 * one. This script is the escape hatch: it refuses to run if an admin
 * already exists, unless --force is passed.
 *
 * Usage (run from the project root so path aliases resolve):
 *   npx ts-node -r tsconfig-paths/register -r dotenv/config \
 *     --compiler-options '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/bootstrap-admin.ts --student-number=20231234
 *
 *   # bypass the "no existing admin" safety check
 *   ... scripts/bootstrap-admin.ts --student-number=20231234 --force
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Role } from 'generated/prisma/client';

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg?.slice(prefix.length);
}

async function main() {
  const studentNumber = getArg('student-number');
  const force = process.argv.includes('--force');

  if (!studentNumber) {
    throw new Error(
      'Missing required --student-number=<value> argument (see script header for usage).',
    );
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable not set');
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const existingAdminCount = await prisma.user.count({
      where: { role: Role.ADMIN },
    });

    if (existingAdminCount > 0 && !force) {
      throw new Error(
        `${existingAdminCount} admin(s) already exist. Ask an existing admin to use ` +
          'POST /auth/role instead, or re-run this script with --force if you really ' +
          'want to bypass that.',
      );
    }

    const user = await prisma.user.findUnique({ where: { studentNumber } });
    if (!user) {
      throw new Error(`No user found with studentNumber "${studentNumber}".`);
    }

    if (user.role === Role.ADMIN) {
      console.log(`${user.name} (${user.uuid}) is already an ADMIN.`);
      return;
    }

    const updated = await prisma.user.update({
      where: { uuid: user.uuid },
      data: { role: Role.ADMIN },
    });

    console.log(
      `Promoted ${updated.name} (${updated.uuid}, studentNumber=${updated.studentNumber}) to ADMIN.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
