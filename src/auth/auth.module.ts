import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InfoteamAccountModule } from '@lib/infoteam-account';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@lib/database';
import { HttpModule } from '@nestjs/axios';
import { PassportModule } from '@nestjs/passport';
import { UserStrategy } from './guard/user.strategy';
import { AuditLogModule } from '@lib/audit-log';

@Module({
  imports: [
    InfoteamAccountModule,
    JwtModule.register({}),
    ConfigModule,
    DatabaseModule,
    HttpModule,
    PassportModule,
    AuditLogModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, UserStrategy],
})
export class AuthModule {}
