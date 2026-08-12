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
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    InfoteamAccountModule,
    JwtModule.register({}),
    ConfigModule,
    DatabaseModule,
    HttpModule,
    PassportModule,
    AuditLogModule,
    NotificationModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, UserStrategy],
})
export class AuthModule {}
