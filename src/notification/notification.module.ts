import { Module } from '@nestjs/common';
import { DatabaseModule } from '@lib/database';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { WebPushService } from './services/web-push.service';

@Module({
  imports: [DatabaseModule],
  controllers: [NotificationController],
  providers: [NotificationService, WebPushService],
  exports: [NotificationService, WebPushService],
})
export class NotificationModule {}
