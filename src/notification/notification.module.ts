import { Module } from '@nestjs/common';
import { DatabaseModule } from '@lib/database';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { WebPushService } from './services/web-push.service';
import { FcmService } from './services/fcm.service';

@Module({
  imports: [DatabaseModule],
  controllers: [NotificationController],
  providers: [NotificationService, WebPushService, FcmService],
  exports: [NotificationService, WebPushService, FcmService],
})
export class NotificationModule {}
