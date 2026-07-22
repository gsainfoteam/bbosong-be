import { Module } from '@nestjs/common';
import { SummaryController } from './summary.controller';
import { SummaryService } from './summary.service';
import { DatabaseModule } from '@lib/database';
import { AuditLogModule } from '@lib/audit-log';

@Module({
  imports: [DatabaseModule, AuditLogModule],
  controllers: [SummaryController],
  providers: [SummaryService],
})
export class SummaryModule {}
