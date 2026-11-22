import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import expressBasicAuth from 'express-basic-auth';
import { AppModule } from './app.module';
import { BbosongConfigService } from './config/bbosong-config.service';
import { MetricsInterceptor } from '@gsainfoteam/nest-observability';

export const makeApp = async () => {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(BbosongConfigService);

  app.use(
    ['/api', '/api-json'],
    expressBasicAuth({
      challenge: true,
      users: {
        [configService.swaggerUser]: configService.swaggerPassword,
      },
    }),
  );

  app.use(cookieParser());

  const corsWhitelist = new Set(configService.corsOrigins);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean | string) => void,
    ) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (corsWhitelist.has(origin)) {
        callback(null, origin);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Bbosong API')
    .setDescription(
      'Backend API for bbosong\n[GitHub](https://github.com/gsainfoteam/bbosong-be)',
    )
    .setVersion('1.0')
    .addTag('Bbosong')
    .addOAuth2(
      {
        type: 'oauth2',
        scheme: 'bearer',
        name: 'infoteam-account-token',
        in: 'header',
        bearerFormat: 'token',
        flows: {
          authorizationCode: {
            authorizationUrl: configService.swaggerAuthUrl,
            tokenUrl: configService.swaggerTokenUrl,
            scopes: {
              email: 'email',
              student_id: 'student_id',
              profile: 'profile',
              // phone_number: 'phone_number',
            },
          },
        },
      },
      'oauth2',
    )
    // .addBearerAuth(
    //   {
    //     type: 'http',
    //     scheme: 'bearer',
    //     name: 'JWT',
    //     in: 'header',
    //   },
    //   'admin',
    // )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        name: 'JWT',
        in: 'header',
      },
      'user',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: {
      persistAuthorization: process.env.NODE_ENV === 'development',
      displayRequestDuration: true,
      oauth2RedirectUrl: `${configService.apiUrl}/api/oauth2-redirect.html`,
      initOAuth: {
        usePkceWithAuthorizationCodeGrant: true,
        clientId: configService.clientId,
      },
    },
  });

  app.useGlobalInterceptors(new MetricsInterceptor());
  app.enableShutdownHooks();

  return app;
};
