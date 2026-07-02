import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSubscriptionPlanDto } from './subscription-plans.dto';

const validFeatures = {
    maxStores: 1,
    maxUsers: 3,
    maxSkus: 2000,
    premiumAccounting: false,
    premiumInventoryReports: false,
    premiumCrm: false,
    multiStore: false,
    apiAccess: false,
    accountingOnly: false,
    planRank: 1,
    aiCreditsMonthly: 100,
};

describe('UpdateSubscriptionPlanDto', () => {
    it('accepts a valid subscription plan payload', async () => {
        const dto = plainToInstance(UpdateSubscriptionPlanDto, {
            name: 'Basic',
            description: 'Core retail operations',
            monthly_price: 499,
            yearly_price: 4990,
            is_active: true,
            features: validFeatures,
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
    });

    it('rejects unknown feature properties', async () => {
        const dto = plainToInstance(UpdateSubscriptionPlanDto, {
            name: 'Basic',
            monthly_price: 499,
            is_active: true,
            features: { ...validFeatures, mysteryFlag: true },
        });

        const errors = await validate(dto, {
            whitelist: true,
            forbidNonWhitelisted: true,
        });
        expect(errors.length).toBeGreaterThan(0);
    });
});