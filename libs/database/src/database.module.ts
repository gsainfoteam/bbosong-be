import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseService } from './database.service';
import { EncryptionService } from './encryption.service';
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
    EncryptionService,
    UserConsentRepository,
    UserRefreshTokenRepository,
    UserRepository,
    AuditLogRepository,
    MachineRepository,
  ],
  exports: [
    DatabaseService,
    EncryptionService,
    UserConsentRepository,
    UserRefreshTokenRepository,
    UserRepository,
    AuditLogRepository,
    MachineRepository,
  ],
})
export class DatabaseModule {}
