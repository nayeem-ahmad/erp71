import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(HttpExceptionFilter.name);

    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();

        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const body = exception.getResponse();
            const message = typeof body === 'string'
                ? body
                : (body as { message?: string | string[] }).message;
            const code = typeof body === 'object' && body !== null && 'code' in body
                ? String((body as { code?: string }).code)
                : HttpStatus[status] ?? 'HTTP_ERROR';
            // Seconds a rate-limited caller should wait. Carried in the body as
            // well as in `Retry-After` because a browser cannot read a response
            // header cross-origin unless it is explicitly exposed, and the app
            // and API are on different hosts in production.
            const retryAfter = typeof body === 'object' && body !== null
                ? Number((body as { retry_after?: number }).retry_after)
                : NaN;

            response.status(status).json({
                error: {
                    code,
                    message: Array.isArray(message) ? message.join(', ') : (message ?? exception.message),
                    ...(Number.isFinite(retryAfter) ? { retry_after: retryAfter } : {}),
                },
            });
            return;
        }

        this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            error: {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'An unexpected error occurred',
            },
        });
    }
}