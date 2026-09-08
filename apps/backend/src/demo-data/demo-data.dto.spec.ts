import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoadDemoDataDto } from './demo-data.dto';

/** Run a payload through the same pipeline the global ValidationPipe uses. */
async function check(payload: unknown) {
    const dto = plainToInstance(LoadDemoDataDto, payload, { enableImplicitConversion: false });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    return { dto, properties: errors.map((error) => error.property) };
}

describe('LoadDemoDataDto', () => {
    it('accepts an empty body — the first load is one click', async () => {
        const { properties } = await check({});
        expect(properties).toEqual([]);
    });

    it('accepts a full selection', async () => {
        const { dto, properties } = await check({
            months: 3,
            modules: ['crm', 'hr', 'finance'],
            includeAnomalies: false,
        });
        expect(properties).toEqual([]);
        expect(dto.months).toBe(3);
        expect(dto.includeAnomalies).toBe(false);
    });

    it('coerces a month count arriving as a string', async () => {
        const { dto, properties } = await check({ months: '6' });
        expect(properties).toEqual([]);
        expect(dto.months).toBe(6);
    });

    it('rejects a month count outside the supported range', async () => {
        expect((await check({ months: 0 })).properties).toEqual(['months']);
        expect((await check({ months: 24 })).properties).toEqual(['months']);
    });

    it('rejects a module name that is not a real group', async () => {
        expect((await check({ modules: ['crm', 'nonsense'] })).properties).toEqual(['modules']);
    });

    it('rejects an unknown field rather than silently ignoring it', async () => {
        // forbidNonWhitelisted is on globally, so a typo in the payload should be
        // an error rather than a batch that quietly loads the default dataset.
        expect((await check({ month: 6 })).properties).toEqual(['month']);
    });
});
