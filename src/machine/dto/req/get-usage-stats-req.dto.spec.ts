import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetUsageStatsReqDto } from './get-usage-stats-req.dto';

const base = { from: '2026-11-01', to: '2026-11-10' };

describe('GetUsageStatsReqDto', () => {
  it('accepts no groupBy', async () => {
    expect(
      await validate(plainToInstance(GetUsageStatsReqDto, base)),
    ).toHaveLength(0);
  });

  it('parses comma separated and single groupBy values', async () => {
    const csv = plainToInstance(GetUsageStatsReqDto, {
      ...base,
      groupBy: 'weekday,hour',
    });
    expect(csv.groupBy).toEqual(['weekday', 'hour']);
    expect(await validate(csv)).toHaveLength(0);

    const single = plainToInstance(GetUsageStatsReqDto, {
      ...base,
      groupBy: 'date',
    });
    expect(single.groupBy).toEqual(['date']);
  });

  it('parses repeated groupBy params', async () => {
    const dto = plainToInstance(GetUsageStatsReqDto, {
      ...base,
      groupBy: ['location', 'gender'],
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it.each(['foo', 'date,date', 'hour,bogus'])(
    'rejects invalid groupBy %s',
    async (groupBy) => {
      expect(
        await validate(
          plainToInstance(GetUsageStatsReqDto, { ...base, groupBy }),
        ),
      ).not.toHaveLength(0);
    },
  );

  it('inherits range validation', async () => {
    expect(
      await validate(
        plainToInstance(GetUsageStatsReqDto, {
          from: '2026-11-10',
          to: '2026-11-01',
        }),
      ),
    ).not.toHaveLength(0);
  });
});
