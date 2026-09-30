import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { PaginatedResult } from './pagination.dto';

type ApiResponse<T> = { data: T; meta?: Record<string, unknown> };
type Transformed<T> = ApiResponse<T> | StreamableFile;

function isPaginatedResult(value: unknown): value is PaginatedResult<unknown> {
    return !!value
        && typeof value === 'object'
        && 'items' in value
        && 'total' in value
        && 'page' in value
        && 'limit' in value
        && 'pages' in value;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Transformed<T>> {
    intercept(_ctx: ExecutionContext, next: CallHandler): Observable<Transformed<T>> {
        return next.handle().pipe(map((data) => {
            if (data instanceof StreamableFile) return data;

            if (isPaginatedResult(data)) {
                const { items, total, page, limit, pages } = data;
                return {
                    data: items as T,
                    meta: { total, page, limit, pages },
                };
            }

            return { data };
        }));
    }
}
