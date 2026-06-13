import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

/**
 * Records request count and latency for every HTTP request. Uses the matched
 * route *template* (e.g. `/products/:id`) rather than the raw URL to keep
 * label cardinality bounded. The scrape endpoint itself is skipped.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
    constructor(private readonly metrics: MetricsService) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType() !== 'http') {
            return next.handle();
        }

        const http = context.switchToHttp();
        const req = http.getRequest();
        const res = http.getResponse();

        const route: string = req.route?.path ?? 'unmatched';
        if (route === '/metrics') {
            return next.handle();
        }

        const method: string = req.method ?? 'UNKNOWN';
        const start = process.hrtime.bigint();

        const record = (statusCode: number) => {
            const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
            this.metrics.observeHttp(method, route, statusCode, durationSeconds);
        };

        return next.handle().pipe(
            tap({
                next: () => record(res.statusCode ?? 200),
                // On error, prefer the exception's HTTP status, else 500.
                error: (err) => record(err?.status ?? err?.statusCode ?? 500),
            }),
        );
    }
}
