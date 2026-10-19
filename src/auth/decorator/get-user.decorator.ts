import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../types/authenticated-user.type';

export const GetUser = createParamDecorator(
  (_data, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>();

    return req.user;
  },
);
