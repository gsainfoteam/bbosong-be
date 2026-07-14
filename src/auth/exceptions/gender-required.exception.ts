import { HttpException, HttpStatus } from '@nestjs/common';

export class GenderRequiredException extends HttpException {
  constructor(
    message: string = 'Gender input is required for first-time login.',
    errorCode: string = 'GENDER_REQUIRED',
  ) {
    super(
      {
        message,
        errorCode,
        statusCode: HttpStatus.FORBIDDEN,
      },
      HttpStatus.FORBIDDEN,
    );
  }
}
