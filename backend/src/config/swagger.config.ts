import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function createSwaggerDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Vendexa SaaS Multi-Tenant E-Commerce API')
    .setDescription(
      'API de la plataforma SaaS Multi-Tienda E-Commerce (B2C + Mayorista B2B): Auth, Planes, CRM SuperAdmin, Storefront y Carrito Persistente.',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access Token JWT de plataforma o cliente de tienda',
      },
      'access-token',
    )
    .addCookieAuth(
      'access_token',
      {
        type: 'apiKey',
        in: 'cookie',
        name: 'access_token',
        description: 'Cookie HttpOnly con Access Token JWT',
      },
      'access_token',
    )
    .addGlobalParameters({
      name: 'x-tenant-host',
      in: 'header',
      required: false,
      description:
        'Hostname de tienda para resolución multi-tenant (ej. moda-mayorista.localhost:3000)',
      schema: { type: 'string' },
    })
    .build();

  return SwaggerModule.createDocument(app, config);
}
