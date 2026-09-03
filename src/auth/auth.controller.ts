import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
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
import { UpdateRoleReqDto } from './dto/req/update-role-req.dto';
import { AdminGuard } from './guard/admin.guard';
import { ConsentRequiredErrorDto } from './dto/res/consent-required-error.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({
    summary: 'User login',
    description:
      'Authenticate user via Infoteam OAuth token and issue JWT access and refresh tokens.',
  })
  @ApiSecurity('oauth2')
  @ApiCreatedResponse({ type: JwtToken, description: 'Login success' })
  @ApiUnauthorizedResponse({ description: 'Invalid Infoteam Account token' })
  @ApiResponse({
    status: 403,
    description: 'Consent required',
    type: ConsentRequiredErrorDto,
  })
  @ApiInternalServerErrorResponse({ description: 'Internal Server Error' })
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body?: UserLoginDto,
  ): Promise<JwtToken> {
    const auth = req.headers['authorization'];
    if (!auth) throw new UnauthorizedException();

    const { access_token, refresh_token, refreshTokenExpiredAt } =
      await this.authService.userLogin(auth, body);

    this.setRefreshTokenCookie(res, refresh_token, refreshTokenExpiredAt);

    return { access_token };
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Refresh access token using HTTP-only refresh token cookie with RTR rotation.',
  })
  @ApiCreatedResponse({
    type: JwtToken,
    description: 'Access token refreshed successfully.',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired refresh token.',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<JwtToken> {
    const refreshToken = req.cookies['refresh_token'] as string;
    if (!refreshToken) throw new UnauthorizedException();

    const { access_token, refresh_token, refreshTokenExpiredAt } =
      await this.authService.userRefresh(refreshToken);
    this.setRefreshTokenCookie(res, refresh_token, refreshTokenExpiredAt);

    return { access_token };
  }

  @Post('logout')
  @ApiOperation({
    summary: 'User logout',
    description:
      'Logout authenticated user and invalidate current refresh token session.',
  })
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
    this.clearRefreshTokenCookie(res);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Retrieve profile information of the authenticated user.',
  })
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

  @Delete('me')
  @ApiOperation({
    summary: 'Delete user account',
    description:
      'Soft-delete the authenticated user and invalidate all associated sessions and push tokens.',
  })
  @ApiBearerAuth('user')
  @UseGuards(UserGuard)
  @ApiOkResponse({
    description:
      'User account successfully deleted and session cookie cleared.',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async deactivateUser(
    @GetUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.authService.deactivateUser(user.uuid);
    this.clearRefreshTokenCookie(res);
  }

  @Post('role')
  @ApiOperation({
    summary: "Update user's role",
    description:
      "Change a target user's role (Admin only). A user cannot change their own role.",
  })
  @ApiBearerAuth('user')
  @UseGuards(AdminGuard)
  @ApiOkResponse({
    type: UserResDto,
    description: "Successfully updated user's role.",
  })
  @ApiForbiddenResponse({ description: "Cannot change oneself's role." })
  @ApiNotFoundResponse({ description: 'Target user not found.' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized.' })
  async updateRole(
    @GetUser() user: User,
    @Body() body: UpdateRoleReqDto,
  ): Promise<UserResDto> {
    if (user.uuid === body.targetUserUuid)
      throw new ForbiddenException("Cannot change oneself's role");
    return this.authService.updateRole(body.targetUserUuid, body.targetRole);
  }

  private setRefreshTokenCookie(
    res: Response,
    refreshToken: string,
    expires: Date,
  ): void {
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      expires,
      path: '/auth',
    });
  }

  private clearRefreshTokenCookie(res: Response): void {
    res.clearCookie('refresh_token', {
      path: '/auth',
    });
  }
}
