import type { BbosongConfigService } from '../../config/bbosong-config.service';

export function getStatsExcludedUserUuids(
  configService?: BbosongConfigService,
): string[] {
  return configService?.statsExcludedUserIds ?? [];
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
