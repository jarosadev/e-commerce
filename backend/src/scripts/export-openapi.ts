import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { createSwaggerDocument } from '../config/swagger.config';

async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    app.setGlobalPrefix('api/v1');
    const document = createSwaggerDocument(app);
    const outputPath = resolve(process.cwd(), 'openapi.json');
    writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    console.log(`OpenAPI exportado correctamente en ${outputPath}`);
  } finally {
    await app.close();
  }
}

void exportOpenApi();
