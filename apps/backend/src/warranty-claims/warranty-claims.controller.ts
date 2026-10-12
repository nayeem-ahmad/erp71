import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { WarrantyClaimsService } from './warranty-claims.service';
import { CreateWarrantyClaimDto, UpdateWarrantyClaimStatusDto } from './warranty-claim.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchListQueryDto } from '../common/branch-list-query.dto';
import { BranchScopeService } from '../database/branch-scope.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { SALES_READ, WARRANTY_WRITE } from '../auth/permission-sets';
@Controller('warranty-claims')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class WarrantyClaimsController {
    constructor(
        private readonly warrantyClaimsService: WarrantyClaimsService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...SALES_READ)
    @Get('lookup')
    async lookup(@Tenant() tenant: TenantContext, @Query('serialNumber') serialNumber: string) {
        return this.warrantyClaimsService.lookup(tenant.tenantId, serialNumber);
    }

    @RequireAnyStorePermission(...WARRANTY_WRITE)
    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateWarrantyClaimDto) {
        return this.warrantyClaimsService.create(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: BranchListQueryDto,
    ) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: SALES_READ });
        return this.warrantyClaimsService.findAll(tenant.tenantId, query.page, query.limit, { timezone: tenant.timezone,
            createdFrom: query.createdFrom,
            createdTo: query.createdTo,
            storeId,
        });
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.warrantyClaimsService.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...WARRANTY_WRITE)
    @Patch(':id/status')
    async updateStatus(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateWarrantyClaimStatusDto,
    ) {
        return this.warrantyClaimsService.updateStatus(tenant.tenantId, id, dto);
    }
}
