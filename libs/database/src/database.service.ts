import { PrismaMetricsService } from '@gsainfoteam/nest-observability';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClientOptions } from '@prisma/client/runtime/client';
import { PrismaClient } from 'generated/prisma/client';

const createPrismaOption = (connectionString: string) =>
  ({
    log: [{ emit: 'event', level: 'query' }] as const,
    adapter: new PrismaPg({ connectionString }),
  }) satisfies PrismaClientOptions;

@Injectable()
export class DatabaseService
  extends PrismaClient<ReturnType<typeof createPrismaOption>>
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    private readonly configService: ConfigService,
    private readonly prismaMetricsService: PrismaMetricsService,
  ) {
    const connectionString = configService.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable not set');
    }
    super(createPrismaOption(connectionString));
    this.$on('query', this.prismaMetricsService.getMetricsMiddleware());
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
