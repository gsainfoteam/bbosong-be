import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class MachinePowerApiKeyGuard implements CanActivate {
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.getOrThrow<string>(
      'MACHINE_POWER_API_KEY',
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // Extract API key from x-api-key header or Authorization Bearer header
    const authHeader = request.headers['authorization'];
    const apiKeyHeader =
      (request.headers['x-api-key'] as string) ||
      (authHeader?.startsWith('Bearer ')
        ? authHeader.substring(7)
        : authHeader);

    if (!apiKeyHeader || apiKeyHeader !== this.apiKey) {
      throw new UnauthorizedException('Invalid API Key');
    }

    return true;
  }
}
