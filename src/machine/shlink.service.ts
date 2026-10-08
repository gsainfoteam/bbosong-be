import { FetchHttpClient } from '@shlinkio/shlink-js-sdk/fetch';
import { ShlinkApiClient } from '@shlinkio/shlink-js-sdk';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ShlinkService {
  private readonly logger = new Logger(ShlinkService.name);
  private readonly client?: ShlinkApiClient;
  private readonly domain?: string;

  constructor(configService: ConfigService) {
    const baseUrl = configService.get<string>('SHLINK_URL');
    const apiKey = configService.get<string>('SHLINK_API_KEY');
    this.domain = configService.get<string>('SHLINK_DOMAIN');

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
        longUrl,
        ...(this.domain ? { domain: this.domain } : {}),
        findIfExists: true,
        signal: AbortSignal.timeout(5000),
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
