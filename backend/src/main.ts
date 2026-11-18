import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { EnvConfig } from './config/env.validation';
import { createSwaggerDocument } from './config/swagger.config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get<ConfigService<EnvConfig, true>>(ConfigService);
  const nodeEnv = configService.get('NODE_ENV', { infer: true });
  const port = configService.get('PORT', { infer: true });
  const frontendUrl = configService.get('FRONTEND_URL', { infer: true });

  app.use(
    helmet({
      contentSecurityPolicy: nodeEnv === 'production' ? undefined : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(cookieParser());

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const allowedExact = new Set<string>([
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        frontendUrl,
      ]);
      const isTenantLocalhostSubdomain = /^https?:\/\/[a-z0-9-]+\.localhost(:\d+)?$/i.test(origin);

      if (allowedExact.has(origin) || isTenantLocalhostSubdomain) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-tenant-host',
      'x-tenant-slug',
      'x-request-id',
      'x-guest-token',
    ],
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  SwaggerModule.setup('api/docs', app, () => createSwaggerDocument(app), {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  app.enableShutdownHooks();

  await app.listen(port);
  logger.log(`Backend ejecutándose en http://localhost:${port}/api/v1`);
  logger.log(`Swagger UI disponible en http://localhost:${port}/api/docs`);
}

void bootstrap();
