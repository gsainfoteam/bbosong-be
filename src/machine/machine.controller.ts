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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserGuard } from '../auth/guard/user.guard';
import { AdminGuard } from '../auth/guard/admin.guard';
import { MachinePowerApiKeyGuard } from '../auth/guard/machine-power-api-key.guard';
import { GetUser } from '../auth/decorator/get-user.decorator';
import { User } from 'generated/prisma/client';
import { MachineService } from './machine.service';
import { GetLaundryRoomStatusReqDto } from './dto/req/get-laundry-room-status-req.dto';
import { GetLaundryRoomStatusResDto } from './dto/res/get-laundry-room-status-res.dto';
import {
  CreateMachineReqDto,
  CreateMultipleMachinesReqDto,
} from './dto/req/create-machine-req.dto';
import {
  CreateMachineResDto,
  CreateMultipleMachinesResDto,
} from './dto/res/create-machine-res.dto';
import { UpdateMachineReqDto } from './dto/req/update-machine-req.dto';
import { CreatePowerReqDto } from './dto/req/create-power-req.dto';
import { GetMachineResDto } from './dto/res/get-machine-res.dto';
import { GetMachineDetailResDto } from './dto/res/get-machine-detail-res.dto';
import { GetMachinePowerResDto } from './dto/res/get-machine-power-res.dto';
import { ToggleNotificationReqDto } from './dto/req/toggle-notification-req.dto';

@Controller('machine')
export class MachineController {
  constructor(private readonly machineService: MachineService) {}

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
    return { uuids: machines.map((item) => item.uuid) };
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
    return await this.machineService.getMachines();
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
  @ApiNotFoundResponse({ description: 'Machine not found.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async getMachine(
    @Param('uuid', ParseUUIDPipe) uuid: string,
  ): Promise<GetMachineDetailResDto> {
    return await this.machineService.getMachineDetail(uuid);
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
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async deleteMachine(@Param('uuid', ParseUUIDPipe) uuid: string) {
    await this.machineService.deleteMachine(uuid);
  }

  @Post('/:uuid/power')
  @ApiOperation({
    summary: 'Record machine power',
    description:
      'Record real-time power consumption data from IoT sensors using API key.',
  })
  @UseGuards(MachinePowerApiKeyGuard)
  @ApiHeader({
    name: 'x-api-key',
    description: 'API key for machine power sensors',
    required: true,
  })
  @ApiCreatedResponse({ description: 'Machine power recorded successfully.' })
  @ApiNotFoundResponse({ description: 'Machine not found.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async recordMachinePower(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() body: CreatePowerReqDto,
  ) {
    await this.machineService.recordMachinePower(uuid, body);
  }

  @Get('/:uuid/power')
  @ApiOperation({
    summary: 'Get machine power history',
    description:
      'Retrieve power consumption records for the last 1 hour for a machine.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({
    type: GetMachinePowerResDto,
    isArray: true,
    description:
      'Successfully retrieved machine power records for the last 1 hour.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async getMachinePower(
    @Param('uuid', ParseUUIDPipe) uuid: string,
  ): Promise<GetMachinePowerResDto[]> {
    return await this.machineService.getMachinePower(uuid);
  }

  @Post('/:uuid/register')
  @ApiOperation({
    summary: 'Register machine usage',
    description:
      'Register authenticated user as operator of a running machine and enable completion notification.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({
    description:
      'Successfully registered machine usage and enabled notification.',
  })
  @ApiNotFoundResponse({
    description: 'Machine is not running or operating user mismatch.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async registerMachineUsage(
    @Param('uuid', ParseUUIDPipe) machineUuid: string,
    @GetUser() user: User,
  ) {
    await this.machineService.enableMachineNotification(user.uuid, machineUuid);
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
    description: 'Successfully toggled machine completion notification.',
  })
  @ApiNotFoundResponse({
    description: 'Machine is not running or operating user mismatch.',
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
}
