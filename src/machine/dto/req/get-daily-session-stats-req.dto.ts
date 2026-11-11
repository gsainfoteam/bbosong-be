import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  Matches,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_INCLUSIVE_DAYS = 90;

@ValidatorConstraint({ name: 'dailySessionStatsRange', async: false })
export class DailySessionStatsRangeConstraint implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const { from, to } = args.object as GetDailySessionStatsReqDto;
    if (!DATE_RE.test(from ?? '') || !DATE_RE.test(to ?? '')) return false;
    if (from > to) return false;
    const fromMs = Date.parse(`${from}T00:00:00+09:00`);
    const toMs = Date.parse(`${to}T00:00:00+09:00`);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return false;
    const inclusiveDays = (toMs - fromMs) / 86_400_000 + 1;
    return inclusiveDays <= MAX_INCLUSIVE_DAYS;
  }

  defaultMessage(): string {
    return `to must be on or after from, and the inclusive range must be at most ${MAX_INCLUSIVE_DAYS} days`;
  }
}

export class GetDailySessionStatsReqDto {
  @ApiProperty({
    description: 'Inclusive KST start date (YYYY-MM-DD)',
    example: '2026-11-01',
  })
  @IsNotEmpty()
  @Matches(DATE_RE)
  from: string;

  @ApiProperty({
    description: 'Inclusive KST end date (YYYY-MM-DD)',
    example: '2026-11-10',
  })
  @IsNotEmpty()
  @Matches(DATE_RE)
  @Validate(DailySessionStatsRangeConstraint)
  to: string;
}
