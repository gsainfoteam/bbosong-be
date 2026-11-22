import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { JwtPayload } from 'jsonwebtoken';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from '../auth.service';
import { BbosongConfigService } from '../../config/bbosong-config.service';

@Injectable()
export class UserStrategy extends PassportStrategy(Strategy, 'user') {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: BbosongConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.userJwtSecret,
      issuer: configService.userJwtIssuer,
      audience: configService.userJwtAudience,
    });
  }

  async validate(payload: JwtPayload & { sessionId?: string }) {
    const { sub, sessionId } = payload;
    if (!sub) throw new UnauthorizedException('invalid token');
    if (!sessionId) throw new UnauthorizedException('sessionId missing');

    const user = await this.authService.findUser(sub);
    const refreshToken = await this.authService.findUserRefreshTokenBySessionId(
      sub,
      sessionId,
    );
    if (!refreshToken) {
      throw new UnauthorizedException('invalid session');
    }

    return { ...user, sessionId };
  }
}
