import { Controller, Get, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { GetMushakPeriodDto, GetSalesBookDto } from './mushak.dto';
import { MushakService } from './mushak.service';

/**
 * NBR Mushak 6.x documents produced from the sales module.
 *
 * Routes are named after the forms rather than after the records behind them,
 * because that is how a user and an NBR officer both refer to them — "print
 * the 6.3", "pull the 6.2 for Ashwin".
 *
 * `StorePermissionGuard` is class-wide; only the books name a permission. A
 * tax invoice or a credit note is the document for one transaction, so anyone
 * who may see that sale may print it — gating it separately would leave a
 * cashier able to view a sale but not hand the customer its invoice. The
 * period books are a different thing: they are the workspace's whole VAT
 * position, so they sit behind VIEW_FINANCIAL_REPORTS like every other report
 * that exposes it.
 */
@Controller('mushak')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class MushakController {
    constructor(private readonly service: MushakService) {}

    /** Which 6.x forms this build produces, and whether the issuer is configured. */
    @Get('forms')
    getForms(@Tenant() tenant: TenantContext) {
        return this.service.getFormCatalogue(tenant.tenantId);
    }

    /** মূসক-৬.২ · বিক্রয় হিসাব পুস্তক — the sales book for a tax period. */
    @Get('6.2')
    @RequireStorePermission(StorePermission.VIEW_FINANCIAL_REPORTS)
    getSalesBook(@Tenant() tenant: TenantContext, @Query() query: GetSalesBookDto) {
        return this.service.getSalesBook(tenant.tenantId, query, tenant.timezone);
    }

    /** মূসক-৬.৩ · কর চালানপত্র — the tax invoice for one sale. */
    @Get('6.3/:saleId')
    getTaxInvoice(@Tenant() tenant: TenantContext, @Param('saleId') saleId: string) {
        return this.service.getTaxInvoice(tenant.tenantId, saleId);
    }

    /** মূসক-৬.৭ · ক্রেডিট নোট — the credit note for one sales return. */
    @Get('6.7/:returnId')
    getCreditNote(@Tenant() tenant: TenantContext, @Param('returnId') returnId: string) {
        return this.service.getCreditNote(tenant.tenantId, returnId);
    }

    /** মূসক-৬.১০ · supplies over two lakh taka to unregistered buyers. */
    @Get('6.10')
    @RequireStorePermission(StorePermission.VIEW_FINANCIAL_REPORTS)
    getLargeSupplyStatement(@Tenant() tenant: TenantContext, @Query() query: GetMushakPeriodDto) {
        return this.service.getLargeSupplyStatement(tenant.tenantId, query, tenant.timezone);
    }
}
