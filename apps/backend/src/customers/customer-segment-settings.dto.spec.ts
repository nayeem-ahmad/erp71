import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSegmentSettingsDto } from './customer.dto';

async function check(payload: unknown) {
    const dto = plainToInstance(UpdateSegmentSettingsDto, payload, { enableImplicitConversion: false });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    return { dto, properties: errors.map((error) => error.property) };
}

const valid = { vip_spend_bdt: 25000, at_risk_days: 45, new_account_days: 14 };

describe('UpdateSegmentSettingsDto', () => {
    it('accepts the three tenant rules', async () => {
        const { dto, properties } = await check(valid);
        expect(properties).toEqual([]);
        expect(dto).toMatchObject(valid);
    });

    it('coerces numbers arriving as strings', async () => {
        const { dto, properties } = await check({
            vip_spend_bdt: '25000',
            at_risk_days: '45',
            new_account_days: '14',
        });
        expect(properties).toEqual([]);
        expect(dto.at_risk_days).toBe(45);
        expect(dto.vip_spend_bdt).toBe(25000);
    });

    it('rejects a zero or negative quiet-days window', async () => {
        expect((await check({ ...valid, at_risk_days: 0 })).properties).toEqual(['at_risk_days']);
        expect((await check({ ...valid, new_account_days: 0 })).properties).toEqual(['new_account_days']);
    });

    it('rejects negative VIP spend', async () => {
        expect((await check({ ...valid, vip_spend_bdt: -1 })).properties).toEqual(['vip_spend_bdt']);
    });

    it('rejects an unknown field rather than silently ignoring it', async () => {
        expect((await check({ ...valid, extra: 1 })).properties).toEqual(['extra']);
    });
});
