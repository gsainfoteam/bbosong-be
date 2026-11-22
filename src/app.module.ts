import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BbosongConfigModule } from './config/bbosong-config.module';
import { AuthModule } from './auth/auth.module';
import { MachineModule } from './machine/machine.module';
import { NotificationModule } from './notification/notification.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    BbosongConfigModule,
    ScheduleModule.forRoot(),
    AuthModule,
    MachineModule,
    NotificationModule,
    HealthModule,
  ],
})
export class AppModule {}
