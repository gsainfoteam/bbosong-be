import { ConfigService } from '@nestjs/config';
import { BbosongConfigService } from '../../config/bbosong-config.service';
import {
  getStatsExcludedUserUuids,
  withStatsExclusion,
} from './stats-exclusion.util';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const config = (value?: string) =>
  new BbosongConfigService(
    new ConfigService({ STATS_EXCLUDED_USER_IDS: value }),
  );

describe('stats exclusion util', () => {
  it('parses comma-separated UUIDs, trimming and dropping invalid ones', () => {
    expect(getStatsExcludedUserUuids(config(` ${A}, bad ,${B},`))).toEqual([
      A,
      B,
    ]);
  });

  it('returns an empty list when unset or no config is given', () => {
    expect(getStatsExcludedUserUuids(config(undefined))).toEqual([]);
    expect(getStatsExcludedUserUuids()).toEqual([]);
  });

  it('merges the excluded users into a filter', () => {
    expect(withStatsExclusion({ type: 'DRYER' }, config(A))).toEqual({
      type: 'DRYER',
      excludeUserUuids: [A],
    });
  });
});
