import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiSecurity,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { User } from 'generated/prisma/client';
import { AuthService } from './auth.service';
import { GetUser } from './decorator/get-user.decorator';
import { UserLoginDto } from './dto/req/user-login.dto';
import { JwtToken } from './dto/res/jwt-token.dto';
import { UserResDto } from './dto/res/user-res.dto';
import { UserGuard } from './guard/user.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiSecurity('oauth2')
  @ApiCreatedResponse({
    type: JwtToken,
    description:
      'User logged in successfully and refresh token cookie was set.',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid authorization header or token.',
  })
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
  @ApiCreatedResponse({
    type: JwtToken,
    description: 'Access token refreshed successfully.',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid or expired refresh token.' })
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
  @ApiCreatedResponse({
    description: 'User logged out successfully and cookie was cleared.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async logout(
    @GetUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.userLogout(user.uuid);
    res.clearCookie('refresh_token', {
      path: '/auth',
    });
  }

  @Get('me')
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({
    type: UserResDto,
    description: 'Successfully retrieved current authenticated user profile.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  getMe(@GetUser() user: User): UserResDto {
    return this.authService.getMe(user);
  }
}
