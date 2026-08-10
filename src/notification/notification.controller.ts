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
import { SubscribeLaundryRoomReqDto } from './dto/req/subscribe-laundry-room-req.dto';

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

  @Post('laundry-room')
  @ApiOperation({
    summary: 'Subscribe to laundry room availability',
    description:
      'Subscribe to get notified when a machine of specified location, gender, and type becomes available.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({
    description:
      'Successfully subscribed to laundry room availability notification.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async subscribeLaundryRoom(
    @GetUser() user: User,
    @Body() body: SubscribeLaundryRoomReqDto,
  ) {
    await this.notificationService.createLaundryRoomSubscription(
      user.uuid,
      body.location,
      body.gender,
      body.type,
    );
    return { success: true };
  }

  @Delete('laundry-room')
  @ApiOperation({
    summary: 'Unsubscribe from laundry room availability',
    description:
      'Unsubscribe from laundry room availability notification for specified location, gender, and type.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({
    description:
      'Successfully unsubscribed from laundry room availability notification.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async unsubscribeLaundryRoom(
    @GetUser() user: User,
    @Body() body: SubscribeLaundryRoomReqDto,
  ) {
    await this.notificationService.deleteLaundryRoomSubscription(
      user.uuid,
      body.location,
      body.gender,
      body.type,
    );
    return { success: true };
  }
}
