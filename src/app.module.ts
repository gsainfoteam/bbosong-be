import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { MachineModule } from './machine/machine.module';
import { NotificationModule } from './notification/notification.module';
import { HealthModule } from './health/health.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    MachineModule,
    NotificationModule,
    HealthModule,
    ScheduleModule.forRoot(),
  ],
})
export class AppModule {}
