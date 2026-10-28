import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchScopeService } from '../database/branch-scope.service';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { InitiateFundTransferDto, ListFundTransfersQueryDto } from './fund-transfers.dto';
import { FundTransfersService } from './fund-transfers.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { FUND_CREATE, FUND_READ, FUND_RECEIVE } from '../auth/permission-sets';
@Controller('fund-transfers')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class FundTransfersController {
    constructor(
        private readonly service: FundTransfersService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...FUND_CREATE)
    @Post()
    async initiate(@Tenant() tenant: TenantContext, @Body() dto: InitiateFundTransferDto) {
        // Cash credits this branch's drawer, so the caller must be allowed to use it.
        const sourceStoreId = await this.branchScope.resolveStoreId(tenant, dto.sourceStoreId, {
            permissions: FUND_CREATE,
            allowAll: false,
        });
        return this.service.initiate(tenant.tenantId, tenant.userId, {
            ...dto,
            sourceStoreId: sourceStoreId ?? dto.sourceStoreId,
        });
    }

    @RequireAnyStorePermission(...FUND_RECEIVE)
    @Post(':id/receive')
    async receive(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        // Same rule as get: a caller who cannot see every branch may receive
        // only a transfer they are a side of.
        const storeIds = (await this.branchScope.canSeeAllBranches(tenant))
            ? undefined
            : await this.branchScope.memberStoreIds(tenant);
        return this.service.receive(tenant.tenantId, tenant.userId, id, storeIds);
    }

    @RequireAnyStorePermission(...FUND_READ)
    @Get()
    async list(@Tenant() tenant: TenantContext, @Query() query: ListFundTransfersQueryDto) {
        // `storeId` matches a transfer whose source OR destination is the
        // branch. `sourceStoreId` / `destinationStoreId` still narrow within
        // that, so with a branch resolved they can only pick among transfers
        // that touch it; with the whole tenant they must at least be its own.
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: FUND_READ });
        if (storeId === undefined) {
            for (const id of [query.sourceStoreId, query.destinationStoreId]) {
                if (id) await this.branchScope.resolveStoreId(tenant, id, { permissions: FUND_READ });
            }
        }
        return this.service.list(tenant.tenantId, { ...query, storeId, timezone: tenant.timezone });
    }

    @RequireAnyStorePermission(...FUND_READ)
    @Get(':id')
    async get(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        const storeIds = (await this.branchScope.canSeeAllBranches(tenant))
            ? undefined
            : await this.branchScope.memberStoreIds(tenant);
        return this.service.get(tenant.tenantId, id, storeIds);
    }
}