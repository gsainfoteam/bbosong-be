import { Module } from '@nestjs/common';
import { UserConsentRepository } from '@lib/database/repositories';
import { UserRefreshTokenRepository } from '@lib/database/repositories';
import { UserRepository } from '@lib/database/repositories';
import { DatabaseService } from './database.service';
import { EncryptionService } from './encryption.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [
    DatabaseService,
    EncryptionService,
    UserConsentRepository,
    UserRefreshTokenRepository,
    UserRepository,
  ],
  exports: [
    DatabaseService,
    EncryptionService,
    UserConsentRepository,
    UserRefreshTokenRepository,
    UserRepository,
  ],
})
export class DatabaseModule {}
