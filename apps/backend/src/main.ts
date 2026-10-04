import './instrument';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppLogger } from './common/app-logger.service';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { getAllowedOrigins } from './common/allowed-origins.util';
import { buildCorsOptions } from './common/cors-options.util';
import { applyProxyTrust } from './common/trust-proxy.util';
import helmet from 'helmet';

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
    // Must precede the throttler guard's first request: it keys rate-limit
    // buckets off `req.ip`, which is the proxy's address until this is set.
    applyProxyTrust(app);
    app.use(json({ limit: '5mb' }));
    app.use(urlencoded({ extended: true, limit: '5mb' }));
    app.useLogger(app.get(AppLogger));
    app.use(helmet());
    app.setGlobalPrefix('api/v1');
    app.enableCors(buildCorsOptions(getAllowedOrigins()));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
