import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UserGuard } from '../auth/guard/user.guard';
import { MachinePowerApiKeyGuard } from '../auth/guard/machine-power-api-key.guard';
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
import { CreatePowerReqDto } from './dto/req/create-power-req.dto';
import { GetMachineResDto } from './dto/res/get-machine-res.dto';
import { GetMachinePowerResDto } from './dto/res/get-machine-power-res.dto';

@ApiBearerAuth('user')
@Controller('machine')
export class MachineController {
  constructor(private readonly machineService: MachineService) {}

  @UseGuards(UserGuard)
  @Get('summary')
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

  @UseGuards(UserGuard)
  @Post()
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

  @UseGuards(UserGuard)
  @Post('/multiple')
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

  @UseGuards(UserGuard)
  @Get()
  @ApiOkResponse({
    type: GetMachineResDto,
    isArray: true,
    description: 'Successfully retrieved all machines.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async getMachines(): Promise<GetMachineResDto[]> {
    return await this.machineService.getMachines();
  }

  @UseGuards(UserGuard)
  @Delete(':uuid')
  @ApiOkResponse({ description: 'Machine deleted successfully.' })
  @ApiNotFoundResponse({ description: 'Machine not found.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async deleteMachine(@Param('uuid') uuid: string) {
    await this.machineService.deleteMachine(uuid);
  }

  @UseGuards(MachinePowerApiKeyGuard)
  @Post('/power/:uuid')
  @ApiHeader({
    name: 'x-api-key',
    description: 'API key for machine power sensors',
    required: true,
  })
  @ApiCreatedResponse({ description: 'Machine power recorded successfully.' })
  @ApiNotFoundResponse({ description: 'Machine not found.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async recordMachinePower(
    @Param('uuid') uuid: string,
    @Body() body: CreatePowerReqDto,
  ) {
    await this.machineService.recordMachinePower(uuid, body);
  }

  @UseGuards(UserGuard)
  @Get('/power/:uuid')
  @ApiOkResponse({
    type: GetMachinePowerResDto,
    isArray: true,
    description:
      'Successfully retrieved machine power records for the last 1 hour.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async getMachinePower(
    @Param('uuid') uuid: string,
  ): Promise<GetMachinePowerResDto[]> {
    return await this.machineService.getMachinePower(uuid);
  }
}
