import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { User } from 'generated/prisma/client';
import { AuthService } from './auth.service';
import { GetUser } from './decorator/get-user.decorator';
import { UserLoginDto } from './dto/req/user-login.dto';
import { JwtToken } from './dto/res/jwt-token.dto';
import { UserGuard } from './guard/user.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiSecurity('oauth2')
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body?: UserLoginDto,
  ): Promise<JwtToken> {
    const auth = req.headers['authorization'];
    if (!auth) throw new UnauthorizedException();

    const { access_token, refresh_token, refreshTokenExpiredAt } =
      await this.authService.userLogin(auth, body);

    res.cookie('refresh_token', refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      expires: refreshTokenExpiredAt,
      path: '/auth',
    });

    return { access_token };
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<JwtToken> {
    const refreshToken = req.cookies['refresh_token'] as string;
    if (!refreshToken) throw new UnauthorizedException();

    const { access_token, refresh_token, refreshTokenExpiredAt } =
      await this.authService.userRefresh(refreshToken);
    res.cookie('refresh_token', refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      expires: refreshTokenExpiredAt,
      path: '/auth',
    });

    return { access_token };
  }

  @Post('logout')
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  async logout(
    @GetUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.userLogout(user.uuid);
    res.clearCookie('refresh_token', {
      path: '/auth',
    });
  }
}
