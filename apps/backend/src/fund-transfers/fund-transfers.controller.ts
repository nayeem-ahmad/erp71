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
    initiate(@Tenant() tenant: TenantContext, @Body() dto: InitiateFundTransferDto) {
        return this.service.initiate(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...FUND_RECEIVE)
    @Post(':id/receive')
    receive(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.receive(tenant.tenantId, tenant.userId, id);
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
    get(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.get(tenant.tenantId, id);
    }
}