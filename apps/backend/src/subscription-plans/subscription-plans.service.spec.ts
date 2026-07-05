import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SubscriptionPlansService } from './subscription-plans.service';

describe('SubscriptionPlansService', () => {
    const db = {
        subscriptionPlan: {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    };
    const audit = { log: jest.fn() };

    let service: SubscriptionPlansService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new SubscriptionPlansService(db as any, audit as any);
    });

    const basePlan = {
        code: 'BASIC',
        name: 'Basic',
        description: 'Entry plan',
        monthly_price: 499,
        yearly_price: 4990,
        is_active: true,
        features_json: {
            maxStores: 1,
            maxUsers: 3,
            maxSkus: 2000,
            premiumAccounting: false,
            premiumInventoryReports: false,
            premiumCrm: false,
            multiStore: false,
            apiAccess: false,
            accountingOnly: false,
            premiumAccountingAdvanced: false,
            premiumManufacturing: false,
            premiumStorefront: false,
            premiumBookPublishing: false,
            premiumAi: false,
            premiumVoice: false,
            planRank: 1,
            aiCreditsMonthly: 100,
        },
        marketing_features_json: ['POS terminal'],
        _count: { subscriptions: 4 },
    };

    const updateDto = {
        name: 'Basic Plus',
        description: 'Updated',
        monthly_price: 599,
        yearly_price: 5990,
        is_active: true,
        features: basePlan.features_json,
    };

    it('lists all plans with subscriber counts', async () => {
        db.subscriptionPlan.findMany.mockResolvedValue([basePlan]);

        const result = await service.listPlans();

        expect(result.plans).toHaveLength(1);
        expect(result.plans[0]).toMatchObject({
            code: 'BASIC',
            subscriber_count: 4,
            monthly_price: 499,
        });
        expect(result.codes).toContain('FREE');
    });

    it('updates a plan and writes an audit log', async () => {
        db.subscriptionPlan.findUnique.mockResolvedValue(basePlan);
        db.subscriptionPlan.update.mockResolvedValue({
            ...basePlan,
            name: updateDto.name,
            monthly_price: updateDto.monthly_price,
        });

        const result = await service.updatePlan('BASIC', updateDto, 'admin-1');

        expect(result.name).toBe('Basic Plus');
        expect(audit.log).toHaveBeenCalledWith(
            'subscription_plan.update',
            'subscription_plan',
            { userId: 'admin-1' },
            'BASIC',
            expect.objectContaining({
                before: expect.objectContaining({ name: 'Basic' }),
                after: expect.objectContaining({ name: 'Basic Plus' }),
            }),
        );
    });

    it('allows deactivating the FREE plan while keeping zero pricing', async () => {
        db.subscriptionPlan.findUnique.mockResolvedValue({
            ...basePlan,
            code: 'FREE',
            monthly_price: 0,
            yearly_price: 0,
        });
        db.subscriptionPlan.update.mockResolvedValue({
            ...basePlan,
            code: 'FREE',
            monthly_price: 0,
            yearly_price: 0,
            is_active: false,
        });

        const result = await service.updatePlan(
            'FREE',
            {
                ...updateDto,
                monthly_price: 0,
                yearly_price: 0,
                is_active: false,
            },
            'admin-1',
        );

        expect(result.is_active).toBe(false);
    });

    it('throws when plan is missing', async () => {
        db.subscriptionPlan.findUnique.mockResolvedValue(null);

        await expect(service.getPlan('PREMIUM')).rejects.toBeInstanceOf(NotFoundException);
    });
});