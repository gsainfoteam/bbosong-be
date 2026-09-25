import { AuditLogModule } from '@lib/audit-log';
import { DatabaseModule } from '@lib/database';
import { MatterClientModule } from '@lib/matter-client/matter-client.module';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationModule } from '../notification/notification.module';
import { MachineController } from './machine.controller';
import { MachineService } from './machine.service';

@Module({
  imports: [
    DatabaseModule,
    AuditLogModule,
    NotificationModule,
    MatterClientModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        sites: configService
          .getOrThrow<string>('MATTER_SITES')
          .split(',')
          .map((config) => {
            const [id, ...urlParts] = config.split('=');
            const wsUrl = urlParts.join('=');
            return { id, wsUrl };
          }),
      }),
    }),
  ],
  controllers: [MachineController],
  providers: [MachineService],
  exports: [MachineService],
})
export class MachineModule {}
