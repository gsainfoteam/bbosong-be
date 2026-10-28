import { AuditLogModule } from '@lib/audit-log';
import { DatabaseModule } from '@lib/database';
import { MatterClientModule } from '@lib/matter-client/matter-client.module';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationModule } from '../notification/notification.module';
import { MachineController } from './machine.controller';
import { MachineService } from './machine.service';
import { MachineConnectivityService } from './machine-connectivity.service';
import { ShlinkService } from './shlink.service';
import { ThinqModule } from '../thinq/thinq.module';
import { ThinqPollingService } from './thinq-polling.service';

@Module({
  imports: [
    DatabaseModule,
    AuditLogModule,
    NotificationModule,
    ThinqModule,
    MatterClientModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        sites: configService
          .getOrThrow<string>('MATTER_SITES')
          .split(',')
          .map((config) => {
            const [id, ...urlParts] = config.split(':');
            const wsUrl = urlParts.join(':');
            return { id, wsUrl };
          }),
      }),
    }),
  ],
  controllers: [MachineController],
  providers: [
    MachineService,
    ShlinkService,
    MachineConnectivityService,
    ThinqPollingService,
  ],
  exports: [MachineService],
})
export class MachineModule {}
