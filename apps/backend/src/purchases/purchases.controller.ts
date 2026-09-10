import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { PaginationDto } from '../common/pagination.dto';
import { CancelEntryDto } from '../common/cancel-entry.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CreatePurchaseDto } from './purchase.dto';
import { PurchasesService } from './purchases.service';

// `StorePermissionGuard` is class-wide but only the cancel route names a
// permission; the guard is a no-op for a handler that requires none, so every
// other route keeps the access it had.
@Controller('purchases')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class PurchasesController {
    constructor(private readonly purchasesService: PurchasesService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreatePurchaseDto) {
        return this.purchasesService.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: PaginationDto,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
        @Query('sortBy') sortBy?: string,
        @Query('sortDir') sortDir?: string,
    ) {
        return this.purchasesService.findAll(tenant.tenantId, query.page, query.limit, { timezone: tenant.timezone,
            createdFrom,
            createdTo,
            sortBy,
            sortDir,
        });
    }

    /**
     * Cancel a posted purchase and reverse its impacts. Tenant-admin only: only
     * OWNER and the Tenant Admin role hold `CANCEL_ENTRY`.
     */
    @Post(':id/cancel')
    @RequireStorePermission(StorePermission.CANCEL_ENTRY)
    cancel(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CancelEntryDto,
    ) {
        return this.purchasesService.cancel(tenant.tenantId, tenant.userId, id, dto.note);
    }

    @Get(':id/invoice')
    getInvoice(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.purchasesService.getInvoiceData(tenant.tenantId, id);
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.purchasesService.findOne(tenant.tenantId, id);
    }
}