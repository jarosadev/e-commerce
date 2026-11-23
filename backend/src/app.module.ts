import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { ClsModule } from 'nestjs-cls';
import { CommonModule } from './common/common.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TenantStatusGuard } from './common/guards/tenant-status.guard';
import { TenantResolutionInterceptor } from './common/interceptors/tenant-resolution.interceptor';
import { EnvConfig, validateEnv } from './config/env.validation';
import { PrismaModule } from './database/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PlansModule } from './modules/plans/plans.module';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
import { StorefrontModule } from './modules/storefront/storefront.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { CartModule } from './modules/cart/cart.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { RedisModule } from './redis/redis.module';

type JwtExpiresIn = NonNullable<JwtModuleOptions['signOptions']>['expiresIn'];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req) => {
          const headerId = req.headers['x-request-id'];
          return typeof headerId === 'string' && headerId.trim() ? headerId.trim() : randomUUID();
        },
      },
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 120,
      },
    ]),
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }) as JwtExpiresIn,
        },
      }),
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        connection: {
          host: config.get('REDIS_HOST', { infer: true }),
          port: config.get('REDIS_PORT', { infer: true }),
          password: config.get('REDIS_PASSWORD', { infer: true }) || undefined,
          maxRetriesPerRequest: null,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 500 },
        },
      }),
    }),
    PrismaModule,
    RedisModule,
    CommonModule,
    HealthModule,
    NotificationsModule,
    AuthModule,
    PlansModule,
    PlatformAdminModule,
    SubscriptionsModule,
    StorefrontModule,
    CartModule,
    TenantsModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantStatusGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantResolutionInterceptor,
    },
  ],
})
export class AppModule {}
