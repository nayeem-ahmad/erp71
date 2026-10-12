import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { SUBSCRIPTION_FEATURE_KEY } from '../auth/subscription-access.decorator';
import { CrmMessageTemplatesController } from './crm-message-templates.controller';

/**
 * Every composer that offers a template — Log, Schedule, Complete — sits behind
 * `premiumCrm`, so a tenant without it could write templates here and never use
 * one. The decorator metadata is what Nest reads at request time, so it is what
 * these assertions read too: drop either decorator and the route opens up again
 * while every service test stays green.
 */
describe('CrmMessageTemplatesController', () => {
    it('requires the premiumCrm entitlement', () => {
        expect(Reflect.getMetadata(SUBSCRIPTION_FEATURE_KEY, CrmMessageTemplatesController)).toBe('premiumCrm');
    });

    it('runs the guard that enforces it', () => {
        // `@RequiresFeature` only sets metadata; without the guard nothing reads it.
        const guards = Reflect.getMetadata(GUARDS_METADATA, CrmMessageTemplatesController) ?? [];
        expect(guards).toContain(SubscriptionAccessGuard);
    });
});
