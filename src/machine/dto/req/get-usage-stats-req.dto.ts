import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsEnum, IsOptional } from 'class-validator';
import { GetDailySessionStatsReqDto } from './get-daily-session-stats-req.dto';

export enum UsageStatsDimension {
  DATE = 'date',
  WEEKDAY = 'weekday',
  HOUR = 'hour',
  LOCATION = 'location',
  GENDER = 'gender',
}

const toArray = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === '') return undefined;
  const list: unknown[] = Array.isArray(value) ? (value as unknown[]) : [value];
  return list.flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]));
};

export class GetUsageStatsReqDto extends GetDailySessionStatsReqDto {
  @ApiPropertyOptional({
    description:
      'Dimensions to group by, comma separated or repeated (date, weekday, hour, location, gender). ' +
      'All are in KST except location/gender, which are the laundry room attributes. ' +
      'Omit for a single total count.',
    enum: UsageStatsDimension,
    isArray: true,
    example: 'weekday,hour',
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayUnique()
  @IsEnum(UsageStatsDimension, { each: true })
  groupBy?: UsageStatsDimension[];
}
