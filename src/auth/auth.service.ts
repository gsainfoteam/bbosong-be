import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import ms, { StringValue } from 'ms';
import {
  catchError,
  firstValueFrom,
  map,
  throwError,
  timeout,
  TimeoutError,
} from 'rxjs';
import { AxiosError } from 'axios';
import crypto from 'node:crypto';

import { InfoteamAccountService } from '@lib/infoteam-account';
import {
  DatabaseService,
  PrismaTransaction,
  UserConsentRepository,
  UserRefreshTokenRepository,
  UserRepository,
} from '@lib/database';
import { ConsentType, Role, User } from 'generated/prisma/client';

import {
  ConsentData,
  ConsentRequirement,
  LatestPolicyVersionResponse,
  LatestPolicyVersions,
  UserConsent,
  ValidatedConsentData,
} from './types/consent.type';
import { IssueTokenType } from './types/jwt-token.type';
import { UserLoginDto } from './dto/req/user-login.dto';
import { UserResDto } from './dto/res/user-res.dto';
import { ConsentRequiredException } from './exceptions/consent-required.exception';
import { AuditLogService } from '@lib/audit-log';
import { NotificationService } from '../notification/notification.service';

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
    private readonly databaseService: DatabaseService,
    private readonly httpService: HttpService,
    private readonly userRepository: UserRepository,
    private readonly userRefreshTokenRepository: UserRefreshTokenRepository,
    private readonly userConsentRepository: UserConsentRepository,
    private readonly auditLogService: AuditLogService,
    private readonly notificationService: NotificationService,
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

  async updateRole(userUuid: string, role: Role) {
    const user = await this.userRepository.updateUserRole(userUuid, role);
    return this.toUserResDto(user);
  }

  private toUserResDto(user: User): UserResDto {
    return {
      uuid: user.uuid,
      name: user.name,
      email: user.email,
      studentNumber: user.studentNumber,
      gender: user.gender,
      role: user.role,
    };
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

  async userLogin(auth: string, body?: UserLoginDto): Promise<IssueTokenType> {
    const token = auth.split(' ')[1];
    if (!token) throw new UnauthorizedException();
    const userinfo = await this.infoteamAccountService.getUserInfo(token);

    const consentData: ConsentData = {
      agreedToTerms: body?.agreedToTerms,
      agreedToPrivacy: body?.agreedToPrivacy,
      termsVersion: body?.termsVersion,
      privacyVersion: body?.privacyVersion,
    };

    const latestPolicyVersions = await this.getLatestPolicyVersions();

    const { user, refreshToken, sessionId, expiredAt } =
      await this.databaseService.$transaction(async (tx: PrismaTransaction) => {
        const existingUser =
          await this.userRepository.findUserByStudentNumberInTx(
            userinfo.studentNumber,
            tx,
          );

        const { termsRequirement, privacyRequirement } =
          await this.checkConsentRequirements(
            existingUser,
            consentData,
            latestPolicyVersions,
            tx,
          );

        const user = await this.userRepository.upsertUserInTx(
          userinfo,
          body?.gender,
          existingUser,
          tx,
        );
        await this.auditLogService.createAuditLogInTx(
          user.uuid,
          'USER_LOGIN',
          '',
          tx,
        );

        await this.saveConsentsIfNeeded(
          user,
          consentData,
          termsRequirement,
          privacyRequirement,
          tx,
        );

        await this.userRefreshTokenRepository.deleteAllUserRefreshTokensInTx(
          user.uuid,
          tx,
        );

        const token = this.generateOpaqueToken();
        const sessionId = this.generateSessionId();
        const hashedToken = this.hashRefreshToken(token);
        const expiredAt = new Date(
          Date.now() + ms(this.userRefreshTokenExpire),
        );
        await this.userRefreshTokenRepository.setUserRefreshTokenInTx(
          user.uuid,
          hashedToken,
          sessionId,
          expiredAt,
          tx,
        );

        return {
          user,
          refreshToken: token,
          sessionId,
          expiredAt,
        };
      });

    return {
      access_token: this.signAccessToken(user.uuid, sessionId),
      refresh_token: refreshToken,
      refreshTokenExpiredAt: expiredAt,
    };
  }

  private signAccessToken(userUuid: string, sessionId: string): string {
    return this.jwtService.sign(
      { sessionId },
      {
        subject: userUuid,
        secret: this.userJwtSecret,
        expiresIn: this.userJwtExpire,
        algorithm: 'HS256',
        audience: this.userJwtAudience,
        issuer: this.userJwtIssuer,
      },
    );
  }

  private async checkConsentRequirements(
    existingUser: User | null,
    consentData: ConsentData,
    latestPolicyVersions: LatestPolicyVersions,
    tx: PrismaTransaction,
  ): Promise<{
    termsRequirement: ConsentRequirement;
    privacyRequirement: ConsentRequirement;
  }> {
    const [latestTermsUserConsent, latestPrivacyUserConsent]: [
      UserConsent | null,
      UserConsent | null,
    ] = existingUser
      ? await Promise.all([
          this.userConsentRepository.getLatestUserConsentInTx(
            existingUser.uuid,
            ConsentType.TERMS_OF_SERVICE,
            tx,
          ),
          this.userConsentRepository.getLatestUserConsentInTx(
            existingUser.uuid,
            ConsentType.PRIVACY_POLICY,
            tx,
          ),
        ])
      : [null, null];

    const termsRequirement = this.checkConsentRequirement(
      latestTermsUserConsent,
      latestPolicyVersions.terms,
    );
    const privacyRequirement = this.checkConsentRequirement(
      latestPrivacyUserConsent,
      latestPolicyVersions.privacy,
    );

    if (termsRequirement.needsConsent || privacyRequirement.needsConsent) {
      this.validateConsentData(
        consentData,
        termsRequirement,
        privacyRequirement,
      );
    }

    return { termsRequirement, privacyRequirement };
  }

  private async saveConsentsIfNeeded(
    user: User,
    consentData: ConsentData,
    termsRequirement: ConsentRequirement,
    privacyRequirement: ConsentRequirement,
    tx: PrismaTransaction,
  ): Promise<void> {
    if (!termsRequirement.needsConsent && !privacyRequirement.needsConsent) {
      return;
    }

    await this.saveUserConsentsInTransaction(
      user,
      {
        termsVersion: consentData.termsVersion!,
        privacyVersion: consentData.privacyVersion!,
      },
      termsRequirement.needsConsent,
      privacyRequirement.needsConsent,
      tx,
    );
  }

  private checkConsentRequirement(
    latestConsent: UserConsent | null,
    activePolicyVersion: string,
  ): ConsentRequirement {
    const needsConsent: boolean =
      latestConsent?.version !== activePolicyVersion;
    const hasNeverConsented: boolean = !latestConsent;

    return {
      needsConsent,
      hasNeverConsented,
      currentVersion: latestConsent?.version,
      requiredVersion: activePolicyVersion,
    };
  }

  private validateConsentData(
    consentData: ConsentData,
    termsRequirement: ConsentRequirement,
    privacyRequirement: ConsentRequirement,
  ): void {
    const isFirstLogin =
      termsRequirement.hasNeverConsented ||
      privacyRequirement.hasNeverConsented;

    this.checkMissingConsents(
      consentData,
      termsRequirement,
      privacyRequirement,
      isFirstLogin,
    );
    this.checkConsentVersionMismatch(
      consentData,
      termsRequirement,
      privacyRequirement,
      isFirstLogin,
    );
  }

  private checkMissingConsents(
    {
      agreedToTerms,
      agreedToPrivacy,
      termsVersion,
      privacyVersion,
    }: ConsentData,
    termsReq: ConsentRequirement,
    privacyReq: ConsentRequirement,
    isFirstLogin: boolean,
  ): void {
    const missingTerms =
      termsReq.needsConsent && (!agreedToTerms || !termsVersion);
    const missingPrivacy =
      privacyReq.needsConsent && (!agreedToPrivacy || !privacyVersion);

    if (missingTerms || missingPrivacy) {
      throw new ConsentRequiredException(
        isFirstLogin
          ? 'Consent required for first login'
          : 'Consent required for updated policy',
        isFirstLogin ? 'CONSENT_REQUIRED' : 'CONSENT_UPDATE_REQUIRED',
        {
          terms: {
            currentVersion: termsReq.currentVersion,
            requiredVersion: termsReq.requiredVersion,
          },
          privacy: {
            currentVersion: privacyReq.currentVersion,
            requiredVersion: privacyReq.requiredVersion,
          },
        },
      );
    }
  }

  private checkConsentVersionMismatch(
    { termsVersion, privacyVersion }: ConsentData,
    termsReq: ConsentRequirement,
    privacyReq: ConsentRequirement,
    isFirstLogin: boolean,
  ): void {
    const invalidTerms =
      termsReq.needsConsent && termsVersion !== termsReq.requiredVersion;
    const invalidPrivacy =
      privacyReq.needsConsent && privacyVersion !== privacyReq.requiredVersion;

    if (invalidTerms || invalidPrivacy) {
      throw new ConsentRequiredException(
        isFirstLogin
          ? 'Invalid consent version for first login'
          : 'Invalid consent version for updated policy',
        isFirstLogin ? 'CONSENT_REQUIRED' : 'CONSENT_UPDATE_REQUIRED',
        {
          terms: {
            currentVersion: termsReq.currentVersion,
            requiredVersion: termsReq.requiredVersion,
          },
          privacy: {
            currentVersion: privacyReq.currentVersion,
            requiredVersion: privacyReq.requiredVersion,
          },
        },
      );
    }
  }

  private async saveUserConsentsInTransaction(
    user: User,
    { termsVersion, privacyVersion }: ValidatedConsentData,
    needTermsConsent: boolean,
    needPrivacyConsent: boolean,
    tx: PrismaTransaction,
  ): Promise<void> {
    const consentsToCreate: Array<{
      consentType: ConsentType;
      version: string;
    }> = [];

    if (needTermsConsent) {
      consentsToCreate.push({
        consentType: ConsentType.TERMS_OF_SERVICE,
        version: termsVersion,
      });
    }

    if (needPrivacyConsent) {
      consentsToCreate.push({
        consentType: ConsentType.PRIVACY_POLICY,
        version: privacyVersion,
      });
    }

    if (consentsToCreate.length > 0) {
      await this.userConsentRepository.createUserConsentsInTx(
        user.uuid,
        consentsToCreate,
        tx,
      );
    }
  }

  private generateOpaqueToken(): string {
    return crypto.randomBytes(32).toString('base64').replace(/[+/=]/g, '');
  }

  private generateSessionId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private hashRefreshToken(token: string): string {
    return crypto
      .createHmac('sha256', this.refreshTokenHmacSecret)
      .update(token)
      .digest('hex');
  }

  async findUser(uuid: string): Promise<User> {
    return this.userRepository.findUser(uuid);
  }

  async findUserRefreshTokenBySessionId(userUuid: string, sessionId: string) {
    return this.userRefreshTokenRepository.findUserRefreshTokenBySessionId(
      userUuid,
      sessionId,
    );
  }

  async userRefresh(refreshToken: string): Promise<IssueTokenType> {
    const hashedToken = this.hashRefreshToken(refreshToken);
    const { userUuid, sessionId, expiredAt } =
      await this.userRefreshTokenRepository.findUserByRefreshToken(hashedToken);

    await this.userRefreshTokenRepository.deleteUserRefreshToken(hashedToken);

    const newRefreshToken = this.generateOpaqueToken();
    const newHashedToken = this.hashRefreshToken(newRefreshToken);
    await this.userRefreshTokenRepository.setUserRefreshToken(
      userUuid,
      newHashedToken,
      sessionId,
      expiredAt,
    );
    return {
      access_token: this.signAccessToken(userUuid, sessionId),
      refresh_token: newRefreshToken,
      refreshTokenExpiredAt: expiredAt,
    };
  }

  async userLogout(userUuid: string): Promise<void> {
    await this.userRefreshTokenRepository.deleteAllUserRefreshTokens(userUuid);
  }

  getMe(user: User): UserResDto {
    return this.toUserResDto(user);
  }

  async deactivateUser(userUuid: string) {
    await this.databaseService.$transaction(async (tx) => {
      await this.userRepository.deleteUserInTx(userUuid, tx);
      await this.userRefreshTokenRepository.deleteAllUserRefreshTokensInTx(
        userUuid,
        tx,
      );
      await this.notificationService.deleteAllUserPushSubscriptionsInTx(
        userUuid,
        tx,
      );
      await this.notificationService.deleteAllUserLaundryRoomSubscriptionsInTx(
        userUuid,
        tx,
      );
      await this.userConsentRepository.deleteUserConsentsInTx(userUuid, tx);
      await this.auditLogService.createAuditLogInTx(
        userUuid,
        'USER_DEACTIVATE',
        'User voluntarily deactivated account',
        tx,
      );
    });

    const maskedUuid =
      userUuid.length > 8 ? `${userUuid.slice(0, 8)}...` : userUuid;
    this.logger.log(`User deactivated successfully: ${maskedUuid}`);
  }
}
