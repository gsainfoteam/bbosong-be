import { Injectable } from '@nestjs/common';
import { Gender } from 'generated/prisma/client';
import { LaundryRoomRepository } from '@lib/database/repositories/laundry-room.repository';
import { LaundryRoomSummary } from '@lib/database/types/laundry-room.type';

@Injectable()
export class SummaryService {
  constructor(private readonly laundryRoomRepository: LaundryRoomRepository) {}

  async laundryRoomStatusByGender(
    gender: Gender,
  ): Promise<LaundryRoomSummary[]> {
    return await this.laundryRoomRepository.getLaundryRoomStatusByRoom(gender);
  }
}
