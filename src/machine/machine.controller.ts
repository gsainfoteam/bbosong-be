import { ConfirmMachineCompletionReqDto } from './dto/req/confirm-machine-completion-req.dto';
import { MachineRegistrationErrorResDto } from './dto/res/machine-registration-error-res.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserGuard } from '../auth/guard/user.guard';
import { AdminGuard } from '../auth/guard/admin.guard';
import { GetUser } from '../auth/decorator/get-user.decorator';
import { User } from 'generated/prisma/client';
import { MachineService } from './machine.service';
import { GetMachineByShortlinkReqDto } from './dto/req/get-machine-by-shortlink-req.dto';
import { GetLaundryRoomStatusReqDto } from './dto/req/get-laundry-room-status-req.dto';
import { GetLaundryRoomStatusResDto } from './dto/res/get-laundry-room-status-res.dto';
import {
  CreateMachineReqDto,
  CreateMultipleMachinesReqDto,
} from './dto/req/create-machine-req.dto';
import {
  BackfillMachineLinksResDto,
  CreateMachineResDto,
  CreateMultipleMachinesResDto,
} from './dto/res/create-machine-res.dto';
import { UpdateMachineReqDto } from './dto/req/update-machine-req.dto';
import { GetMachineResDto } from './dto/res/get-machine-res.dto';
import { GetMachineDetailResDto } from './dto/res/get-machine-detail-res.dto';
import { GetMachinePowerReqDto } from './dto/req/get-machine-power-req.dto';
import { GetMachinePowerResDto } from './dto/res/get-machine-power-res.dto';
import { GetMachineUsageHistoryReqDto } from './dto/req/get-machine-usage-history-req.dto';
import { GetUsingMachineResDto } from './dto/res/get-using-machine-res.dto';
import { ToggleNotificationReqDto } from './dto/req/toggle-notification-req.dto';
import { SuccessResDto } from '../common/dto/res/success-res.dto';

@Controller('machine')
export class MachineController {
  constructor(private readonly machineService: MachineService) {}

  @Post('/links/backfill')
  @ApiOperation({
    summary: 'Create links for machines that do not have one',
    description:
      'Retry Shlink link creation for machines without a saved link (Admin only).',
  })
  @ApiBearerAuth('user')
  @UseGuards(AdminGuard)
  @ApiOkResponse({ type: BackfillMachineLinksResDto })
  async backfillMachineLinks(): Promise<BackfillMachineLinksResDto> {
    return await this.machineService.backfillMachineLinks();
  }

  @Post('/:uuid/link')
  @ApiOperation({
    summary: 'Create or retrieve a machine link',
    description:
      'Create the machine registration link or return its existing value (Admin only).',
  })
  @ApiBearerAuth('user')
  @UseGuards(AdminGuard)
  @ApiOkResponse({ type: CreateMachineResDto })
  async ensureMachineLink(
    @Param('uuid', ParseUUIDPipe) uuid: string,
  ): Promise<CreateMachineResDto> {
    const machine = await this.machineService.ensureMachineLinkByUuid(uuid);
    return {
      uuid: machine.uuid,
      shortUrl: machine.shortUrl!,
      shortCode: machine.shortCode,
    };
  }

  @Get('summary')
  @ApiOperation({
    summary: 'Get laundry room summary status',
    description:
      'Retrieve count of available machines grouped by location, gender, and type.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({
    type: GetLaundryRoomStatusResDto,
    isArray: true,
    description: 'Successfully retrieved laundry room machine status summary.',
  })
  async getLaundryRoomStatus(
    @Query() query: GetLaundryRoomStatusReqDto,
  ): Promise<GetLaundryRoomStatusResDto[]> {
    return await this.machineService.laundryRoomStatusByGender(query.gender);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a single machine',
    description:
      'Create a new machine in a specified laundry room (Admin only).',
  })
  @ApiBearerAuth('user')
  @UseGuards(AdminGuard)
  @ApiCreatedResponse({
    type: CreateMachineResDto,
    description: 'Machine created successfully.',
  })
  @ApiConflictResponse({
    description: 'Machine index already exists in the room.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async createMachine(
    @Query() query: CreateMachineReqDto,
  ): Promise<CreateMachineResDto> {
    const machine = await this.machineService.createMachine(query);

    return {
      uuid: machine.uuid,
      shortUrl: machine.shortUrl,
      shortCode: machine.shortCode,
    };
  }

  @Post('/multiple')
  @ApiOperation({
    summary: 'Create multiple machines',
    description:
      'Create multiple machines sequentially in a specified laundry room (Admin only).',
  })
  @ApiBearerAuth('user')
  @UseGuards(AdminGuard)
  @ApiCreatedResponse({
    type: CreateMultipleMachinesResDto,
    description: 'Multiple machines created successfully.',
  })
  @ApiConflictResponse({
    description: 'One or more machine indices already exist.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async createMultipleMachines(
    @Query() query: CreateMultipleMachinesReqDto,
  ): Promise<CreateMultipleMachinesResDto> {
    const machines = await this.machineService.createMultipleMachines(query);
    return {
      uuids: machines.map((item) => item.uuid),
      shortUrls: machines.map((item) => item.shortUrl),
      shortCodes: machines.map((item) => item.shortCode),
    };
  }

  @Get()
  @ApiOperation({
    summary: 'Get all machines',
    description: 'Retrieve a list of all registered machines.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({
    type: GetMachineResDto,
    isArray: true,
    description: 'Successfully retrieved all machines.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async getMachines(): Promise<GetMachineResDto[]> {
    return (await this.machineService.getMachines()).map(
      (machine) => new GetMachineResDto(machine),
    );
  }

  @Get('/me')
  @ApiOperation({
    summary: 'Get machines currently used by current user',
    description:
      "Retrieve active machine usage sessions linked to the authenticated user's account.",
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({
    type: GetUsingMachineResDto,
    isArray: true,
    description: "Successfully retrieved the user's machine usage sessions.",
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async getUsingMachinesByUser(
    @GetUser() user: User,
  ): Promise<GetUsingMachineResDto[]> {
    return await this.machineService.getUsingMachinesByUser(user.uuid);
  }

  @Get('/me/history')
  @ApiOperation({
    summary: 'Get current user machine usage history',
    description:
      'Retrieve completed usage sessions for the authenticated user, newest first. Supports limit and offset pagination.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({ type: GetUsingMachineResDto, isArray: true })
  @ApiBadRequestResponse({ description: 'Invalid pagination parameters.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async getUsageHistoryByUser(
    @GetUser() user: User,
    @Query() query: GetMachineUsageHistoryReqDto,
  ): Promise<GetUsingMachineResDto[]> {
    return this.machineService.getUsageHistoryByUser(
      user.uuid,
      query.limit,
      query.offset,
    );
  }

  @Get('by-shortlink')
  @ApiOperation({
    summary: 'Get machine detail by shortlink',
    description:
      'Retrieve machine detail and current usage using the short code from the QR URL scanned in the app, without following a redirect.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({ type: GetMachineDetailResDto })
  @ApiBadRequestResponse({ description: 'Invalid short code.' })
  @ApiForbiddenResponse({
    description: 'Machine gender does not match user gender.',
  })
  @ApiNotFoundResponse({ description: 'Machine not found.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async getMachineByShortlink(
    @Query() query: GetMachineByShortlinkReqDto,
    @GetUser() user: User,
  ): Promise<GetMachineDetailResDto> {
    return new GetMachineDetailResDto(
      await this.machineService.getMachineDetailByShortCode(
        query.shortCode,
        user.gender,
      ),
    );
  }

  @Get(':uuid')
  @ApiOperation({
    summary: 'Get machine detail',
    description:
      'Retrieve all information of a machine by UUID, including its current usage session.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({
    type: GetMachineDetailResDto,
    description: 'Successfully retrieved machine detail.',
  })
  @ApiForbiddenResponse({
    description: 'Machine gender does not match user gender.',
  })
  @ApiNotFoundResponse({ description: 'Machine not found.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async getMachine(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @GetUser() user: User,
  ): Promise<GetMachineDetailResDto> {
    return new GetMachineDetailResDto(
      await this.machineService.getMachineDetail(uuid, user.gender),
    );
  }

  @Patch(':uuid')
  @ApiOperation({
    summary: 'Update machine info',
    description: 'Update specified machine properties by UUID (Admin only).',
  })
  @ApiBearerAuth('user')
  @UseGuards(AdminGuard)
  @ApiOkResponse({ description: 'Machine updated successfully.' })
  @ApiNotFoundResponse({ description: 'Machine not found.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async updateMachine(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() body: UpdateMachineReqDto,
  ): Promise<void> {
    await this.machineService.updateMachine(uuid, body);
  }

  @Delete(':uuid')
  @ApiOperation({
    summary: 'Delete a machine',
    description: 'Delete a machine by its UUID (Admin only).',
  })
  @ApiBearerAuth('user')
  @UseGuards(AdminGuard)
  @ApiOkResponse({ description: 'Machine deleted successfully.' })
  @ApiNotFoundResponse({ description: 'Machine not found.' })
  @ApiConflictResponse({ description: 'Machine has usage history.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async deleteMachine(@Param('uuid', ParseUUIDPipe) uuid: string) {
    await this.machineService.deleteMachine(uuid);
  }

  @Get('/:uuid/power')
  @ApiOperation({
    summary: 'Get machine power history',
    description:
      'Retrieve power consumption records for a machine. Without `startedAt`, records for the last 1 hour are returned. With `startedAt`, records recorded at or after that time are returned. At most 5000 records are returned, oldest first.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({
    type: GetMachinePowerResDto,
    isArray: true,
    description: 'Successfully retrieved machine power records.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async getMachinePower(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Query() query: GetMachinePowerReqDto,
  ): Promise<GetMachinePowerResDto[]> {
    return await this.machineService.getMachinePower(uuid, query.startedAt);
  }

  @Post('/:uuid/register')
  @ApiOperation({
    summary: 'Register machine usage',
    description:
      'Register authenticated user as operator of a running machine and enable completion notification.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiCreatedResponse({
    type: SuccessResDto,
    description:
      'Successfully registered machine usage and enabled notification.',
  })
  @ApiForbiddenResponse({
    description: 'Machine gender does not match user gender.',
  })
  @ApiNotFoundResponse({
    description:
      'Machine not found, or machine is not running (MACHINE_NOT_RUNNING).',
  })
  @ApiConflictResponse({
    description:
      'Under 30 minutes: MACHINE_ALREADY_REGISTERED. At least 30 minutes: MACHINE_COMPLETION_CONFIRMATION_REQUIRED with usageUuid.',
    type: MachineRegistrationErrorResDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async registerMachineUsage(
    @Param('uuid', ParseUUIDPipe) machineUuid: string,
    @GetUser() user: User,
  ) {
    await this.machineService.enableMachineNotification(
      user.uuid,
      machineUuid,
      user.gender,
    );
    return { success: true };
  }

  @Post('/:uuid/register/confirm-completion')
  @ApiOperation({
    summary: 'Confirm previous completion and register a new usage',
    description:
      'Requires a different registered user and at least 30 minutes since session start. Atomically closes the expected session with zero duration and starts a new one. Push is sent to the previous user after commit.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiCreatedResponse({ type: SuccessResDto })
  @ApiBadRequestResponse({ description: 'Invalid machine UUID or usageUuid.' })
  @ApiForbiddenResponse({
    description: 'Machine gender does not match user gender.',
  })
  @ApiNotFoundResponse({
    description: 'Machine not found or MACHINE_NOT_RUNNING.',
  })
  @ApiConflictResponse({
    type: MachineRegistrationErrorResDto,
    description:
      'MACHINE_USAGE_CHANGED: register again. MACHINE_ALREADY_REGISTERED: condition not met.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async confirmMachineCompletion(
    @Param('uuid', ParseUUIDPipe) machineUuid: string,
    @GetUser() user: User,
    @Body() body: ConfirmMachineCompletionReqDto,
  ): Promise<SuccessResDto> {
    await this.machineService.confirmCompletedAndRegister(
      user.uuid,
      machineUuid,
      user.gender,
      body.usageUuid,
    );
    return { success: true };
  }

  @Patch('/:uuid/notification')
  @ApiOperation({
    summary: 'Toggle machine completion notification',
    description:
      'Enable or disable completion notification for the machine operator.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({
    type: SuccessResDto,
    description: 'Successfully toggled machine completion notification.',
  })
  @ApiForbiddenResponse({
    description: 'Machine gender does not match user gender.',
  })
  @ApiNotFoundResponse({
    description:
      'Machine not found or not running (MACHINE_NOT_RUNNING when enabling notification); operating user mismatch when disabling notification.',
  })
  @ApiConflictResponse({
    description:
      'When enabling: MACHINE_ALREADY_REGISTERED or MACHINE_COMPLETION_CONFIRMATION_REQUIRED with usageUuid after 30 minutes.',
    type: MachineRegistrationErrorResDto,
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async toggleMachineNotification(
    @Param('uuid', ParseUUIDPipe) machineUuid: string,
    @GetUser() user: User,
    @Body() body: ToggleNotificationReqDto,
  ) {
    if (body.notifyOnCompletion) {
      await this.machineService.enableMachineNotification(
        user.uuid,
        machineUuid,
        user.gender,
      );
    } else {
      await this.machineService.disableMachineNotification(
        user.uuid,
        machineUuid,
      );
    }
    return { success: true };
  }

  @Delete('/:uuid/register')
  @ApiOperation({
    summary: 'Unregister machine usage',
    description:
      'Unlink current user from the machine usage session (set userUuid to null).',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({
    type: SuccessResDto,
    description: 'Successfully unregistered machine usage (unlinked user).',
  })
  @ApiNotFoundResponse({
    description: 'Machine is not running or operating user mismatch.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async unregisterMachineUsage(
    @Param('uuid', ParseUUIDPipe) machineUuid: string,
    @GetUser() user: User,
  ) {
    await this.machineService.unlinkUserFromMachine(user.uuid, machineUuid);
    return { success: true };
  }

  @Post('/:uuid/commission')
  @ApiOperation({
    summary: 'Commission a machine',
    description: 'Commission a machine by its UUID (Admin only).',
  })
  @ApiBearerAuth('user')
  @UseGuards(AdminGuard)
  @ApiCreatedResponse({ description: 'Machine commissioned successfully.' })
  @ApiNotFoundResponse({ description: 'Machine not found.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async commissionMachine(@Param('uuid', ParseUUIDPipe) machineUuid: string) {
    await this.machineService.commissionMachine(machineUuid);
    return { success: true };
  }
}
