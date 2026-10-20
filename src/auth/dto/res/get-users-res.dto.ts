import { ApiProperty } from '@nestjs/swagger';
import { UserResDto } from './user-res.dto';

export class UserPushSubscriptionResDto {
  @ApiProperty({ description: 'The unique UUID of the push subscription' })
  uuid: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'User agent of the device that registered the subscription',
  })
  userAgent: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'When the push subscription was first registered',
  })
  createdAt: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When a push notification was last successfully sent; null if no successful send has been recorded',
  })
  lastActivatedAt: Date | null;
}

export class GetUsersResDto extends UserResDto {
  @ApiProperty({
    type: [UserPushSubscriptionResDto],
    description:
      'Currently registered push subscriptions; an empty array means no registered devices',
  })
  pushSubscriptions: UserPushSubscriptionResDto[];
}
