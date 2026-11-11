import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetDailySessionStatsReqDto } from './get-daily-session-stats-req.dto';

describe('GetDailySessionStatsReqDto', () => {
  it('accepts a valid inclusive range within 90 days', async () => {
    const dto = plainToInstance(GetDailySessionStatsReqDto, {
      from: '2026-11-01',
      to: '2026-11-10',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts a single-day range', async () => {
    const dto = plainToInstance(GetDailySessionStatsReqDto, {
      from: '2026-11-11',
      to: '2026-11-11',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([
    { from: '2026-11-10', to: '2026-11-09' },
    { from: '2026-01-01', to: '2026-04-02' }, // 92 days inclusive
    { from: '11-01-2026', to: '2026-11-10' },
    { from: '2026-11-01', to: undefined },
    { from: undefined, to: '2026-11-10' },
  ])('rejects invalid range: %j', async (query) => {
    expect(
      await validate(plainToInstance(GetDailySessionStatsReqDto, query)),
    ).not.toHaveLength(0);
  });

  it('accepts exactly 90 inclusive days', async () => {
    const dto = plainToInstance(GetDailySessionStatsReqDto, {
      from: '2026-01-01',
      to: '2026-03-31', // 90 days
    });
    expect(await validate(dto)).toHaveLength(0);
  });
});
