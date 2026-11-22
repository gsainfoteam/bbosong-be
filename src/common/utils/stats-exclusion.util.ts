import type { BbosongConfigService } from '../../config/bbosong-config.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Comma-separated user UUIDs from STATS_EXCLUDED_USER_IDS; invalid entries are dropped.
export function getStatsExcludedUserUuids(
  configService?: BbosongConfigService,
): string[] {
  const raw = configService?.statsExcludedUserIds ?? '';
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => UUID_RE.test(id));
}

export function withStatsExclusion<T extends object>(
  filter: T,
  configService?: BbosongConfigService,
): T & { excludeUserUuids: string[] } {
  return {
    ...filter,
    excludeUserUuids: getStatsExcludedUserUuids(configService),
  };
}
