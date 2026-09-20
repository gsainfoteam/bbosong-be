import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseService } from './database.service';
import {
  UserConsentRepository,
  UserRefreshTokenRepository,
  UserRepository,
  AuditLogRepository,
  MachineRepository,
  NotificationRepository,
  UsingMachineRepository,
} from './repositories';
import { PrismaMetricsService } from '@gsainfoteam/nest-observability';

@Module({
  imports: [ConfigModule],
  providers: [
    DatabaseService,
    UserConsentRepository,
    UserRefreshTokenRepository,
    UserRepository,
    AuditLogRepository,
    MachineRepository,
    NotificationRepository,
    UsingMachineRepository,
    PrismaMetricsService,
  ],
  exports: [
    DatabaseService,
    UserConsentRepository,
    UserRefreshTokenRepository,
    UserRepository,
    AuditLogRepository,
    MachineRepository,
    NotificationRepository,
    UsingMachineRepository,
  ],
})
export class DatabaseModule {}
