import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant, TenantContext } from '../database/tenant.decorator';
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
    constructor(private readonly service: FundTransfersService) {}

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
    list(@Tenant() tenant: TenantContext, @Query() query: ListFundTransfersQueryDto) {
        return this.service.list(tenant.tenantId, { ...query, timezone: tenant.timezone });
    }

    @RequireAnyStorePermission(...FUND_READ)
    @Get(':id')
    get(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.get(tenant.tenantId, id);
    }
}