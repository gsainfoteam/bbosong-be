import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { SummaryService } from './summary.service';
import { FindMachineStatusResDto } from './dto/res/find-machine-status-res.dto';
import { Gender } from '../../generated/prisma/enums';

@Controller('summary')
export class SummaryController {
  constructor(private readonly summaryService: SummaryService) {}

  @ApiBearerAuth('summary')
  @UseGuards(UseGuards)
  @Get()
  async getSummary(
    @Query() gender: Gender,
  ): Promise<FindMachineStatusResDto[]> {
    return await this.summaryService.laundryRoomStatusByGender(gender);
  }
}
