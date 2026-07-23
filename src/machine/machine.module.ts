import { Module } from '@nestjs/common';
import { MachineController } from './machine.controller';
import { MachineService } from './machine.service';
import { DatabaseModule } from '@lib/database';
import { AuditLogModule } from '@lib/audit-log';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  controllers: [MachineController],
  providers: [MachineService],
})
export class MachineModule {}
