import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { MachineModule } from './machine/machine.module';
import { NotificationModule } from './notification/notification.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AuthModule,
    MachineModule,
    NotificationModule,
    HealthModule,
  ],
})
export class AppModule {}
