import { Body, Controller, Get, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { SalesExchangesService } from './sales-exchanges.service';
import { CreateSalesExchangeDto } from './sales-exchanges.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchListQueryDto } from '../common/branch-list-query.dto';
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
    async findAll(@Tenant() tenant: TenantContext, @Query() query: BranchListQueryDto) {
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: SALES_READ });
        return this.exchangesService.findAll(tenant.tenantId, query.page, query.limit, {
            timezone: tenant.timezone,
            createdFrom: query.createdFrom,
            createdTo: query.createdTo,
            storeId,
        });
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
}
