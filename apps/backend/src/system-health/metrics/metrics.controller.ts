import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { MetricsService } from './metrics.service';
import { MetricsTokenGuard } from './metrics-token.guard';

/**
 * Prometheus scrape endpoint. Served at `/api/v1/metrics` (the app's global
 * prefix applies). Uses @Res() to emit raw exposition text, bypassing the
 * global JSON TransformInterceptor.
 */
@Controller('metrics')
@SkipThrottle()
@UseGuards(MetricsTokenGuard)
export class MetricsController {
    constructor(private readonly metrics: MetricsService) {}

    @Get()
    async scrape(@Res() res: Response): Promise<void> {
        const body = await this.metrics.render();
        res.setHeader('Content-Type', this.metrics.contentType);
        res.send(body);
    }
}
