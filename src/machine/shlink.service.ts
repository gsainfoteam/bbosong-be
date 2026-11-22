import { FetchHttpClient } from '@shlinkio/shlink-js-sdk/fetch';
import { ShlinkApiClient } from '@shlinkio/shlink-js-sdk';
import type { ShlinkApiClient as ShlinkApiClientContract } from '@shlinkio/shlink-js-sdk/api-contract';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BbosongConfigService } from '../config/bbosong-config.service';

@Injectable()
export class ShlinkService {
  private readonly logger = new Logger(ShlinkService.name);
  private readonly client?: ShlinkApiClientContract;
  private readonly domain?: string;
  private readonly shortCodeLength?: number;
  private readonly tag?: string;

  constructor(configService: BbosongConfigService) {
    const baseUrl = configService.shlinkUrl;
    const apiKey = configService.shlinkApiKey;
    this.domain = configService.shlinkDomain;
    this.tag = configService.shlinkTag;
    this.shortCodeLength = configService.shlinkShortCodeLength;

    if (baseUrl && apiKey) {
      this.client = new ShlinkApiClient(new FetchHttpClient(), {
        baseUrl: baseUrl.replace(/\/+$/, ''),
        apiKey,
      });
    }
  }

  async ensureShortUrl(longUrl: string): Promise<string> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Shlink is not configured. Set SHLINK_URL and SHLINK_API_KEY.',
      );
    }

    try {
      const created = await this.client.createShortUrl({
        shortCodeLength: this.shortCodeLength,
        longUrl,
        ...(this.domain ? { domain: this.domain } : {}),
        findIfExists: true,
        signal: AbortSignal.timeout(5000),
        tags: this.tag ? [this.tag] : undefined,
      });
      return created.shortUrl;
    } catch (error: unknown) {
      this.logger.error(
        `Failed to create Shlink URL for ${longUrl}: ${String(error)}`,
      );
      throw new ServiceUnavailableException('Could not create machine link.');
    }
  }
}
