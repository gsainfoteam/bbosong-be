import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { StringValue } from 'ms';
import { InfoteamAccountService } from '@lib/infoteam-account';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import {
  LatestPolicyVersionResponse,
  LatestPolicyVersions,
} from './types/consent.type';
import {
  catchError,
  firstValueFrom,
  map,
  throwError,
  timeout,
  TimeoutError,
} from 'rxjs';
import { AxiosError } from 'axios';

@Injectable()
export class AuthService {
  private readonly userJwtSecret: string;
  private readonly userJwtExpire: StringValue;
  private readonly userJwtAudience: string;
  private readonly userJwtIssuer: string;
  private readonly userRefreshTokenExpire: StringValue;
  private readonly refreshTokenHmacSecret: string;
  private readonly policyApiUrl: string;
  private readonly ServiceNameForPolicyVersion: string;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly infoteamAccountService: InfoteamAccountService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.userJwtSecret =
      this.configService.getOrThrow<string>('USER_JWT_SECRET');
    this.userJwtExpire =
      this.configService.getOrThrow<StringValue>('USER_JWT_EXPIRE');
    this.userJwtAudience =
      this.configService.getOrThrow<string>('USER_JWT_AUDIENCE');
    this.userJwtIssuer =
      this.configService.getOrThrow<string>('USER_JWT_ISSUER');
    this.userRefreshTokenExpire = this.configService.getOrThrow<StringValue>(
      'USER_REFRESH_TOKEN_EXPIRE',
    );
    this.refreshTokenHmacSecret = this.configService.getOrThrow<string>(
      'REFRESH_TOKEN_HMAC_SECRET',
    );
    this.policyApiUrl = this.configService.getOrThrow<string>('POLICY_API_URL');
    this.ServiceNameForPolicyVersion = this.configService.getOrThrow<string>(
      'SERVICE_NAME_FOR_POLICY_VERSION',
    );
  }

  private async getLatestPolicyVersions(): Promise<LatestPolicyVersions> {
    const { service, tos, privacy } = await firstValueFrom(
      this.httpService.get<LatestPolicyVersionResponse>(this.policyApiUrl).pipe(
        timeout(10_000),
        map((res) => res.data),
        catchError((err: unknown) => {
          if (err instanceof TimeoutError) {
            this.logger.error('Policy API timeout after 10000ms');
            return throwError(
              () => new InternalServerErrorException('Policy API timeout'),
            );
          }

          const axiosErr = err as AxiosError;
          this.logger.error(axiosErr?.message ?? 'Unknown error');
          return throwError(
            () =>
              new InternalServerErrorException(
                'Failed to fetch policy versions',
              ),
          );
        }),
      ),
    );

    if (service !== this.ServiceNameForPolicyVersion) {
      this.logger.error('Service name for policy version mismatch');
      throw new InternalServerErrorException(
        'Service name for policy version mismatch',
      );
    }

    if (!tos || !privacy) {
      this.logger.error('Missing required policy version fields');
      throw new InternalServerErrorException(
        'Missing required policy version fields',
      );
    }

    return {
      terms: tos,
      privacy: privacy,
    };
  }


}
