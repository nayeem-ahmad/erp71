import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsTokenGuard } from './metrics-token.guard';

/**
 * Prometheus metrics: a token-guarded scrape endpoint plus a global
 * interceptor that records HTTP request count/latency. JobTrackerService
 * (for job gauges) comes from the @Global() JobsModule.
 */
@Module({
    controllers: [MetricsController],
    providers: [
        MetricsService,
        MetricsTokenGuard,
        { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    ],
})
export class MetricsModule {}
