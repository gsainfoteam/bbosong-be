import { Module } from '@nestjs/common';
import { DatabaseModule } from '@lib/database';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { WebPushService } from './services/web-push.service';
import { FcmService } from './services/fcm.service';
import { ApnsHttpClient } from './services/apns-http-client';
import { ApnsService } from './services/apns.service';
import { SlackWebhookService } from './services/slack-webhook.service';
import { LiveActivityService } from './services/live-activity.service';
import { LiveUpdateService } from './services/live-update.service';

@Module({
  imports: [DatabaseModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    WebPushService,
    FcmService,
    ApnsHttpClient,
    ApnsService,
    LiveActivityService,
    LiveUpdateService,
    SlackWebhookService,
  ],
  exports: [
    NotificationService,
    WebPushService,
    FcmService,
    ApnsService,
    LiveActivityService,
    LiveUpdateService,
  ],
})
export class NotificationModule {}
