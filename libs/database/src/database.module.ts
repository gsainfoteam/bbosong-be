import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseService } from './database.service';
import {
  UserConsentRepository,
  UserRefreshTokenRepository,
  UserRepository,
  AuditLogRepository,
  MachineRepository,
} from './repositories';

@Module({
  imports: [ConfigModule],
  providers: [
    DatabaseService,
    UserConsentRepository,
    UserRefreshTokenRepository,
    UserRepository,
    AuditLogRepository,
    MachineRepository,
  ],
  exports: [
    DatabaseService,
    UserConsentRepository,
    UserRefreshTokenRepository,
    UserRepository,
    AuditLogRepository,
    MachineRepository,
  ],
})
export class DatabaseModule {}
