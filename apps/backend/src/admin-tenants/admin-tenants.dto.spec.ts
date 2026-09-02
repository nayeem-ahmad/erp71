import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { TENANT_OVERRIDABLE_FEATURE_KEYS } from '@erp71/shared-types';
import { UpdateAdminTenantFeaturesDto } from './admin-tenants.dto';

/**
 * The feature DTO restates TENANT_OVERRIDABLE_FEATURE_KEYS by hand, and the admin UI
 * builds its payload from that same list. Because the global pipe runs with
 * `forbidNonWhitelisted`, a key present in the list but missing from the DTO
 * does not fail partially — it rejects the entire request, so "Save features"
 * silently does nothing and every other toggle reverts on refresh.
 *
 * These run the real pipe configuration from main.ts rather than validating
 * the class directly, so the test fails the same way production did.
 */
describe('UpdateAdminTenantFeaturesDto', () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const metadata = { type: 'body' as const, metatype: UpdateAdminTenantFeaturesDto };

    it('accepts every tenant-overridable feature key', async () => {
        const payload = Object.fromEntries(TENANT_OVERRIDABLE_FEATURE_KEYS.map((key) => [key, true]));

        await expect(pipe.transform(payload, metadata)).resolves.toBeDefined();
    });

    it('accepts null for every key, which is how an override is cleared', async () => {
        const payload = Object.fromEntries(TENANT_OVERRIDABLE_FEATURE_KEYS.map((key) => [key, null]));

        const result = await pipe.transform(payload, metadata);
        for (const key of TENANT_OVERRIDABLE_FEATURE_KEYS) {
            expect(result).toHaveProperty(key, null);
        }
    });

    it('still rejects a key that is not a platform feature', async () => {
        await expect(pipe.transform({ notAFeature: true }, metadata)).rejects.toThrow(BadRequestException);
    });

    it('rejects a platform-scoped switch, which no single tenant may override', async () => {
        await expect(pipe.transform({ platformProjects: true }, metadata)).rejects.toThrow(BadRequestException);
    });
});
