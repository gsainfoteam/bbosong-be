import { Body, Controller, Post, Headers, Delete } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { SubscribeReqDto } from './dto/req/subscribe-req.dto';
import { GetUser } from '../auth/decorator/get-user.decorator';
import { User } from '../../generated/prisma/client';

@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post('register')
  async registerPush(
    @Body() dto: SubscribeReqDto,
    @Headers('user-agent') userAgent: string,
    @GetUser() user: User,
  ) {
    await this.notificationService.registerPush(user.uuid, dto, userAgent);
    return { success: true };
  }

  @Delete('unregister')
  async unregisterPush(@Body('endpoint') endpoint: string) {
    await this.notificationService.unregisterPush(endpoint);
    return { success: true };
  }
}
