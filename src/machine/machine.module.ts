import { Module } from '@nestjs/common';
import { MachineController } from './machine.controller';
import { MachineService } from './machine.service';
import { DatabaseModule } from '@lib/database';
import { AuditLogModule } from '@lib/audit-log';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [DatabaseModule, AuditLogModule, NotificationModule],
  controllers: [MachineController],
  providers: [MachineService],
  exports: [MachineService],
})
export class MachineModule {}
