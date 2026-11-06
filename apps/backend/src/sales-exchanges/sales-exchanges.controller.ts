import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { SalesExchangesService } from './sales-exchanges.service';
import { CreateSalesExchangeDto, SalesExchangeListQueryDto } from './sales-exchanges.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { readSalesDocumentListFilters } from '../common/sales-document-list-filters';
import { readIdListQuery } from '../common/number-condition.util';
import { BranchScopeService } from '../database/branch-scope.service';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { SALE_DELETE, SALES_READ, SALES_RETURN_WRITE } from '../auth/permission-sets';
import { TrackHistory } from '../record-history/track-history.decorator';
import { CancelEntryDto } from '../common/cancel-entry.dto';
import { MushakService } from '../mushak/mushak.service';

@Controller('sales-exchanges')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class SalesExchangesController {
    constructor(
        private readonly exchangesService: SalesExchangesService,
        private readonly branchScope: BranchScopeService,
        private readonly mushak: MushakService,
    ) {}

    @RequireAnyStorePermission(...SALES_RETURN_WRITE)
    @TrackHistory('SALES_EXCHANGE', { action: 'CREATE' })
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateSalesExchangeDto) {
        return this.exchangesService.create(tenant.tenantId, tenant.userId, dto);
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get()
    async findAll(@Tenant() tenant: TenantContext, @Query() query: SalesExchangeListQueryDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: SALES_READ });
        return this.exchangesService.findAll(tenant.tenantId, query.page, query.limit, {
            ...this.listFilters(tenant, query, storeId),
            sortBy: query.sortBy,
            sortDir: query.sortDir,
        });
    }

    /**
     * The stats strip above the exchanges list, over the same filters as
     * `GET /sales-exchanges`. Declared before `:id`.
     */
    @RequireAnyStorePermission(...SALES_READ)
    @Get('summary')
    async summary(@Tenant() tenant: TenantContext, @Query() query: SalesExchangeListQueryDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: SALES_READ });
        return this.exchangesService.summary(tenant.tenantId, this.listFilters(tenant, query, storeId));
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.exchangesService.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...SALE_DELETE)
    @TrackHistory('SALES_EXCHANGE', { action: 'CANCEL' })
    @Post(':id/cancel')
    cancel(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CancelEntryDto,
    ) {
        return this.exchangesService.cancel(tenant.tenantId, tenant.userId, id, dto.note);
    }

    /** মূসক-৬.৩ for the goods that went out, numbered with the exchange. */
    @RequireAnyStorePermission(...SALES_READ)
    @Get(':id/mushak')
    mushakInvoice(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.mushak.getExchangeTaxInvoice(tenant.tenantId, id);
    }

    /** মূসক-৬.৭ for the goods that came back, against the original invoice. */
    @RequireAnyStorePermission(...SALES_READ)
    @Get(':id/credit-note')
    creditNote(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.mushak.getExchangeCreditNote(tenant.tenantId, id);
    }

    private listFilters(tenant: TenantContext, query: SalesExchangeListQueryDto, storeId: string | undefined) {
        return {
            ...readSalesDocumentListFilters(query, { storeId, timezone: tenant.timezone }),
            settlementModes: readIdListQuery(query.settlement),
        };
    }
}
