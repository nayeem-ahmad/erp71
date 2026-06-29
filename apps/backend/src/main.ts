import './instrument';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { AppLogger } from './common/app-logger.service';
import { HttpExceptionFilter } from './common/http-exception.filter';
import helmet from 'helmet';

async function bootstrap() {
    const app = await NestFactory.create(AppModule, { bufferLogs: true, bodyParser: false });
    app.use(json({ limit: '5mb' }));
    app.use(urlencoded({ extended: true, limit: '5mb' }));
    app.useLogger(app.get(AppLogger));
    app.use(helmet());
    app.setGlobalPrefix('api/v1');
    app.enableCors({
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
