import { Controller, Post, Get, Body, Param, Query, UseGuards, UseInterceptors, Patch, Delete } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { SalesService } from './sales.service';
import { CreateSaleDto, FinalizeSaleDto, UpdateSaleDto } from './sale.dto';
import { CancelEntryDto } from '../common/cancel-entry.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

// `StorePermissionGuard` is class-wide but only the cancel route names a
// permission; the guard is a no-op for a handler that requires none, so every
// other route keeps the access it had.
@Controller('sales')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class SalesController {
    constructor(private readonly salesService: SalesService) { }

    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateSaleDto) {
        return this.salesService.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('mine') mine?: string,
        @Query('search') search?: string,
        @Query('status') status?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortDir') sortDir?: string,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
    ) {
        const mineOnly = mine === 'true' || mine === '1';
        return this.salesService.findAll(tenant.tenantId, { timezone: tenant.timezone,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            createdBy: mineOnly ? tenant.userId : undefined,
            search: search || undefined,
            status: status || undefined,
            sortBy: sortBy || undefined,
            sortDir: sortDir || undefined,
            createdFrom: createdFrom || undefined,
            createdTo: createdTo || undefined,
        });
    }

    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.salesService.findOne(tenant.tenantId, id);
    }

    @Get(':id/invoice')
    async getInvoice(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.salesService.getInvoiceData(tenant.tenantId, id);
    }

    @Post(':id/finalize')
    async finalize(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: FinalizeSaleDto,
    ) {
        return this.salesService.finalizeDraft(tenant.tenantId, tenant.userId, id, dto);
    }

    @Patch(':id')
    async update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateSaleDto) {
        return this.salesService.update(tenant.tenantId, id, dto);
    }

    /**
     * Cancel a posted sale and reverse its impacts. Tenant-admin only: only
     * OWNER and the Tenant Admin role hold `CANCEL_ENTRY`.
     */
    @Post(':id/cancel')
    @RequireStorePermission(StorePermission.CANCEL_ENTRY)
    async cancel(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CancelEntryDto,
    ) {
        return this.salesService.cancel(tenant.tenantId, tenant.userId, id, dto.note);
    }

    @Delete(':id')
    async remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.salesService.remove(tenant.tenantId, id);
    }
}
