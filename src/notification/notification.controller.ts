import {
  Body,
  Controller,
  Delete,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserGuard } from '../auth/guard/user.guard';
import { GetUser } from '../auth/decorator/get-user.decorator';
import { User } from 'generated/prisma/client';
import { NotificationService } from './notification.service';
import { SubscribeReqDto } from './dto/req/subscribe-req.dto';

@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @Post('register')
  @ApiOkResponse({ description: 'Successfully registered push device.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async registerPush(
    @Body() dto: SubscribeReqDto,
    @Headers('user-agent') userAgent: string,
    @GetUser() user: User,
  ) {
    await this.notificationService.registerPush(user.uuid, dto, userAgent);
    return { success: true };
  }

  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @Delete('unregister')
  @ApiOkResponse({ description: 'Successfully unregistered push device.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async unregisterPush(@Body('endpoint') endpoint: string) {
    await this.notificationService.unregisterPush(endpoint);
    return { success: true };
  }
}
