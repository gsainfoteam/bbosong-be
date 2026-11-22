import type { ConfigService } from '@nestjs/config';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Comma-separated user UUIDs from STATS_EXCLUDED_USER_IDS; invalid entries are dropped.
export function getStatsExcludedUserUuids(
  configService?: ConfigService,
): string[] {
  const raw = configService?.get<string>('STATS_EXCLUDED_USER_IDS') ?? '';
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => UUID_RE.test(id));
}

export function withStatsExclusion<T extends object>(
  filter: T,
  configService?: ConfigService,
): T & { excludeUserUuids: string[] } {
  return {
    ...filter,
    excludeUserUuids: getStatsExcludedUserUuids(configService),
  };
}
