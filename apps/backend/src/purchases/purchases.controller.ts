import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { CancelEntryDto } from '../common/cancel-entry.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission, RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchScopeService } from '../database/branch-scope.service';
import { CreatePurchaseDto, PurchaseListQueryDto, UpdatePurchaseDto } from './purchase.dto';
import { PURCHASE_PAYMENT_STATUSES, PurchasesService, type PurchaseListFilters, type PurchasePaymentStatus } from './purchases.service';
import { readDocumentListFilters } from '../common/document-list-filters';
import { readIdListQuery, readNumberConditionQuery } from '../common/number-condition.util';

import { PURCHASE_READ, PURCHASE_WRITE } from '../auth/permission-sets';
import { TrackHistory } from '../record-history/track-history.decorator';
// `StorePermissionGuard` is class-wide but only the cancel route names a
// permission; the guard is a no-op for a handler that requires none, so every
// other route keeps the access it had.
@Controller('purchases')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class PurchasesController {
    constructor(
        private readonly purchasesService: PurchasesService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...PURCHASE_WRITE)
    @TrackHistory('PURCHASE', { action: 'CREATE' })
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreatePurchaseDto) {
        return this.purchasesService.create(tenant.tenantId, tenant.userId, dto);
    }

    /** The list's filters, read once for the rows and the stats strip alike. */
    private async listFilters(tenant: TenantContext, query: PurchaseListQueryDto): Promise<PurchaseListFilters> {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: PURCHASE_READ });
        const paymentStatus = readIdListQuery(query.paymentStatus)?.map((value) => value.toUpperCase());
        if (paymentStatus?.some((value) => !PURCHASE_PAYMENT_STATUSES.includes(value as PurchasePaymentStatus))) {
            throw new BadRequestException(`paymentStatus takes ${PURCHASE_PAYMENT_STATUSES.join(', ')}`);
        }
        return {
            ...readDocumentListFilters(query, { storeId, timezone: tenant.timezone }),
            paid: readNumberConditionQuery(query.paid, 'paid'),
            paymentStatus: paymentStatus as PurchasePaymentStatus[] | undefined,
        };
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: PurchaseListQueryDto,
    ) {
        const filters = await this.listFilters(tenant, query);
        return this.purchasesService.findAll(tenant.tenantId, query.page, query.limit, {
            ...filters,
            sortBy: query.sortBy,
            sortDir: query.sortDir,
        });
    }

    /**
     * The stats strip above the purchases list: counts and amounts over the
     * same filters as `GET /purchases`. Declared before `:id`, which would
     * take "summary" for an id.
     */
    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get('summary')
    async summary(
        @Tenant() tenant: TenantContext,
        @Query() query: PurchaseListQueryDto,
    ) {
        return this.purchasesService.summary(tenant.tenantId, await this.listFilters(tenant, query));
    }

    /**
     * Correct a recorded purchase. Same permission as recording one, as on the
     * sales side: an edit carries its changes through stock, the supplier's
     * account and the books, and refuses what `cancel` refuses.
     */
    @RequireAnyStorePermission(...PURCHASE_WRITE)
    @TrackHistory('PURCHASE', { action: 'UPDATE' })
    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdatePurchaseDto) {
        return this.purchasesService.update(tenant.tenantId, tenant.userId, id, dto);
    }

    /**
     * Cancel a posted purchase and reverse its impacts. Tenant-admin only: only
     * OWNER and the Tenant Admin role hold `CANCEL_ENTRY`.
     */
    @TrackHistory('PURCHASE', { action: 'CANCEL' })
    @Post(':id/cancel')
    @RequireStorePermission(StorePermission.CANCEL_ENTRY)
    cancel(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CancelEntryDto,
    ) {
        return this.purchasesService.cancel(tenant.tenantId, tenant.userId, id, dto.note);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get(':id/invoice')
    getInvoice(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.purchasesService.getInvoiceData(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...PURCHASE_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.purchasesService.findOne(tenant.tenantId, id);
    }
}