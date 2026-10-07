import { Controller, ForbiddenException, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresPlan } from '../auth/subscription-access.decorator';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { PURCHASE_READ, SALES_READ } from '../auth/permission-sets';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchScopeService } from '../database/branch-scope.service';
import { MobilePulseService } from './mobile-pulse.service';
import { BranchQueryDto } from '../common/branch-query.dto';

/**
 * Endpoints shaped for the phone. Each is a narrower view of a web dashboard,
 * guarded exactly as that dashboard is, so the app shows nothing that was not
 * already reachable by whoever holds the phone.
 */
@Controller('mobile')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@UseInterceptors(TenantInterceptor)
@RequiresPlan('BASIC')
export class MobileController {
    constructor(
        private readonly pulse: MobilePulseService,
        private readonly branchScope: BranchScopeService,
    ) {}

    /** Guarded as Sales › Overview, which it summarises. */
    @RequireAnyStorePermission(...SALES_READ)
    @Get('pulse')
    async getPulse(@Tenant() tenant: TenantContext, @Query() query: BranchQueryDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: SALES_READ });
        const includePayables = await this.canReadPurchasing(tenant, storeId);
        return this.pulse.getPulse(tenant.tenantId, storeId, tenant.timezone, { includePayables });
    }

    /**
     * Payables belong to purchasing, which a sales-only member cannot open on
     * the web; the pulse leaves them out rather than refuse the whole screen.
     * Asked through the same branch rule the purchase dashboard uses. A whole-
     * tenant pulse already required owner or `VIEW_CONSOLIDATED_REPORTS`, and
     * the latter is in `PURCHASE_READ`.
     */
    private async canReadPurchasing(tenant: TenantContext, storeId: string | undefined): Promise<boolean> {
        if (storeId === undefined) return true;
        try {
            await this.branchScope.resolveStoreId(tenant, storeId, { permissions: PURCHASE_READ });
            return true;
        } catch (error) {
            if (error instanceof ForbiddenException) return false;
            throw error;
        }
    }
}
