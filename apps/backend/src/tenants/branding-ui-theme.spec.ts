import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TenantsService } from './tenants.service';
import { UpdateBrandingDto } from './update-branding.dto';
import { DatabaseService } from '../database/database.service';
import { AuthCacheService } from '../database/auth-cache.service';
import { TenantTimezoneService } from '../database/tenant-timezone.service';
import { PlanEntitlementsService } from '../subscription-plans/plan-entitlements.service';

describe('Branding — UI style', () => {
    let service: TenantsService;

    const db = {
        tenant: {
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    };

    beforeEach(async () => {
        jest.resetAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                TenantsService,
                { provide: DatabaseService, useValue: db },
                { provide: AuthCacheService, useValue: new AuthCacheService({ ttlMs: 0 }) },
                { provide: PlanEntitlementsService, useValue: { assertEntitlement: jest.fn() } },
                {
                    provide: TenantTimezoneService,
                    useValue: {
                        for: jest.fn(async () => 'Asia/Dhaka'),
                        forMany: jest.fn(async () => new Map()),
                        prime: jest.fn(),
                        invalidate: jest.fn(),
                    },
                },
            ],
        }).compile();

        service = module.get(TenantsService);
    });

    it('reads the style along with the rest of the branding', async () => {
        db.tenant.findUnique.mockResolvedValue({ ui_theme: 'COLORFUL' });
        await service.getBranding('tenant-1');
        expect(db.tenant.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'tenant-1' }, select: expect.objectContaining({ ui_theme: true }) }),
        );
    });

    it('saves a chosen style for that tenant only', async () => {
        db.tenant.update.mockResolvedValue({ ui_theme: 'POLISHED' });
        await service.updateBranding('tenant-1', { ui_theme: 'POLISHED' });
        expect(db.tenant.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'tenant-1' }, data: { ui_theme: 'POLISHED' } }),
        );
    });

    it('leaves the style alone when a branding save does not mention it', async () => {
        db.tenant.update.mockResolvedValue({});
        await service.updateBranding('tenant-1', { brand_business_name: 'Rahman Super Shop' });
        expect(db.tenant.update.mock.calls[0][0].data).not.toHaveProperty('ui_theme');
    });

    it.each(['CLASSIC', 'POLISHED', 'COLORFUL'])('accepts %s', async (ui_theme) => {
        const errors = await validate(plainToInstance(UpdateBrandingDto, { ui_theme }));
        expect(errors).toHaveLength(0);
    });

    it.each(['colorful', 'DARK', '', 42])('rejects %p', async (ui_theme) => {
        const errors = await validate(plainToInstance(UpdateBrandingDto, { ui_theme }));
        expect(errors.map((e) => e.property)).toContain('ui_theme');
    });

    it('saves the sidebar colour on its own', async () => {
        db.tenant.update.mockResolvedValue({ ui_sidebar: 'NAVY' });
        await service.updateBranding('tenant-1', { ui_sidebar: 'NAVY' });
        expect(db.tenant.update.mock.calls[0][0].data).toEqual({ ui_sidebar: 'NAVY' });
    });

    it.each(['LIGHT', 'NAVY'])('accepts sidebar %s', async (ui_sidebar) => {
        const errors = await validate(plainToInstance(UpdateBrandingDto, { ui_sidebar }));
        expect(errors).toHaveLength(0);
    });

    it.each(['DARK', 'navy', ''])('rejects sidebar %p', async (ui_sidebar) => {
        const errors = await validate(plainToInstance(UpdateBrandingDto, { ui_sidebar }));
        expect(errors.map((e) => e.property)).toContain('ui_sidebar');
    });

    describe('Recent menu items switch', () => {
        it('is read and returned with the rest of the branding', async () => {
            db.tenant.findUnique.mockResolvedValue({ nav_recent_enabled: true });
            await service.getBranding('tenant-1');
            expect(db.tenant.findUnique.mock.calls[0][0].select).toEqual(
                expect.objectContaining({ nav_recent_enabled: true }),
            );
        });

        it('switches off on its own, without touching anything else', async () => {
            db.tenant.update.mockResolvedValue({ nav_recent_enabled: false });
            await service.updateBranding('tenant-1', { nav_recent_enabled: false });
            expect(db.tenant.update.mock.calls[0][0]).toEqual(expect.objectContaining({
                where: { id: 'tenant-1' },
                data: { nav_recent_enabled: false },
                select: expect.objectContaining({ nav_recent_enabled: true }),
            }));
        });

        it('is left alone when a branding save does not mention it', async () => {
            db.tenant.update.mockResolvedValue({});
            await service.updateBranding('tenant-1', { ui_sidebar: 'NAVY' });
            expect(db.tenant.update.mock.calls[0][0].data).not.toHaveProperty('nav_recent_enabled');
        });

        it.each([true, false])('accepts %p', async (nav_recent_enabled) => {
            const errors = await validate(plainToInstance(UpdateBrandingDto, { nav_recent_enabled }));
            expect(errors).toHaveLength(0);
        });

        it.each(['true', 1, 'on'])('rejects %p', async (nav_recent_enabled) => {
            const errors = await validate(plainToInstance(UpdateBrandingDto, { nav_recent_enabled }));
            expect(errors.map((e) => e.property)).toContain('nav_recent_enabled');
        });

        it('never writes a null that @IsOptional let through to the non-null column', async () => {
            db.tenant.update.mockResolvedValue({});
            await service.updateBranding('tenant-1', { nav_recent_enabled: null as unknown as boolean });
            expect(db.tenant.update.mock.calls[0][0].data).not.toHaveProperty('nav_recent_enabled');
        });
    });
});
