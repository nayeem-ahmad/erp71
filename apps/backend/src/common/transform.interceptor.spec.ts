import { StreamableFile } from '@nestjs/common';
import { of } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { TransformInterceptor } from './transform.interceptor';

describe('TransformInterceptor', () => {
    const interceptor = new TransformInterceptor();

    it('does not wrap a StreamableFile in { data }', async () => {
        const file = new StreamableFile(Buffer.from('gzip-bytes'));
        const result = await firstValueFrom(
            interceptor.intercept({} as never, { handle: () => of(file) }),
        );
        expect(result).toBe(file);
    });

    it('still wraps a plain payload in { data }', async () => {
        const result = await firstValueFrom(
            interceptor.intercept({} as never, { handle: () => of({ id: 'snap-1' }) }),
        );
        expect(result).toEqual({ data: { id: 'snap-1' } });
    });
});
