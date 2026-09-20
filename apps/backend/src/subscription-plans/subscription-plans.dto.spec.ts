import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { defaultPlanFeatures } from '@erp71/shared-types';
import { UpdateSubscriptionPlanDto } from './subscription-plans.dto';

/**
 * Derived from the registry rather than hand-listed: the plan editor always
 * posts every registered entitlement (normalizePlanFeatures starts from
 * defaultPlanFeatures), so a key added to the registry but not to the DTO
 * makes forbidNonWhitelisted reject every save. A hardcoded list here hid
 * exactly that drift.
 */
const validFeatures = defaultPlanFeatures();

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

    it('accepts every entitlement the registry defines', async () => {
        const dto = plainToInstance(UpdateSubscriptionPlanDto, {
            name: 'Business',
            monthly_price: 2499,
            is_active: true,
            features: validFeatures,
        });

        const errors = await validate(dto, {
            whitelist: true,
            forbidNonWhitelisted: true,
        });
        expect(errors).toHaveLength(0);
    });

    it('declares a field for every registry entitlement', async () => {
        const dto = plainToInstance(UpdateSubscriptionPlanDto, {
            name: 'Business',
            monthly_price: 2499,
            is_active: true,
            features: validFeatures,
        });

        const errors = await validate(dto, {
            whitelist: true,
            forbidNonWhitelisted: true,
        });
        const missing = (errors[0]?.children ?? [])
            .filter((child) => child.constraints?.whitelistValidation)
            .map((child) => child.property);

        expect(missing).toEqual([]);
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
