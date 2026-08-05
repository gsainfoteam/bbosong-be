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
  ApiOperation,
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

  @Post('register')
  @ApiOperation({
    summary: 'Register push device',
    description:
      'Register or update Web Push device subscription credentials for the authenticated user.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
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

  @Delete('unregister')
  @ApiOperation({
    summary: 'Unregister push device',
    description:
      'Remove a Web Push device subscription belonging to the authenticated user.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({ description: 'Successfully unregistered push device.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async unregisterPush(
    @Body('endpoint') endpoint: string,
    @GetUser() user: User,
  ) {
    await this.notificationService.unregisterPush(user.uuid, endpoint);
    return { success: true };
  }
}
