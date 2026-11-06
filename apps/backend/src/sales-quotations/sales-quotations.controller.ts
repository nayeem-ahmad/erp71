import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, UseInterceptors, Delete } from '@nestjs/common';
import { SalesQuotationsService, type QuotationListFilters } from './sales-quotations.service';
import {
    CreateQuotationDto,
    UpdateQuotationDto,
    UpdateQuotationStatusDto,
    ListQuotationsQueryDto,
    QUOTATION_DOC_KINDS,
} from './sales-quotations.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchScopeService } from '../database/branch-scope.service';
import { readSalesDocumentListFilters } from '../common/sales-document-list-filters';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { QUOTATION_WRITE, SALES_READ } from '../auth/permission-sets';
@Controller('sales-quotations')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class SalesQuotationsController {
    constructor(
        private readonly quotationsService: SalesQuotationsService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @RequireAnyStorePermission(...QUOTATION_WRITE)
    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateQuotationDto) {
        return this.quotationsService.create(tenant.tenantId, dto);
    }

    /** The list's filters, read once for the rows and the stats strip alike. */
    private async listFilters(tenant: TenantContext, query: ListQuotationsQueryDto): Promise<QuotationListFilters> {
        // Allow-listed rather than passed straight through: `doc_kind` reaches a
        // Prisma `where`, and an unchecked query param there is a filter the
        // caller gets to write.
        const docKind = query.docKind;
        const storeId = await this.branchScope.resolveStoreId(tenant, query.storeId, { permissions: SALES_READ });
        return {
            ...readSalesDocumentListFilters(query, { storeId, timezone: tenant.timezone }),
            docKind: QUOTATION_DOC_KINDS.includes(docKind as never) ? docKind : undefined,
        };
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: ListQuotationsQueryDto,
    ) {
        return this.quotationsService.findAll(tenant.tenantId, query.page, query.limit, {
            ...(await this.listFilters(tenant, query)),
            sortBy: query.sortBy,
            sortDir: query.sortDir,
        });
    }

    /**
     * The stats strip above the list, over the same filters as
     * `GET /sales-quotations`. Declared before `:id`, which would take
     * "summary" for an id.
     */
    @RequireAnyStorePermission(...SALES_READ)
    @Get('summary')
    async summary(
        @Tenant() tenant: TenantContext,
        @Query() query: ListQuotationsQueryDto,
    ) {
        return this.quotationsService.summary(tenant.tenantId, await this.listFilters(tenant, query));
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.quotationsService.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...QUOTATION_WRITE)
    @Patch(':id')
    async update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateQuotationDto) {
        return this.quotationsService.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...QUOTATION_WRITE)
    @Patch(':id/status')
    async updateStatus(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateQuotationStatusDto) {
        return this.quotationsService.updateStatus(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...QUOTATION_WRITE)
    @Post(':id/revise')
    async revise(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.quotationsService.revise(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...QUOTATION_WRITE)
    @Post(':id/convert')
    async convertToOrder(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.quotationsService.convertToOrder(tenant.tenantId, tenant.userId, id);
    }

    @RequireAnyStorePermission(...QUOTATION_WRITE)
    @Post(':id/share')
    share(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.quotationsService.share(tenant.tenantId, tenant.userId, id);
    }

    // Declared before the general `:id` delete route below, or that route would
    // capture `/share` too and revoking a share would delete the quotation.
    @RequireAnyStorePermission(...QUOTATION_WRITE)
    @Delete(':id/share')
    revokeShare(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.quotationsService.revokeShare(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...QUOTATION_WRITE)
    @Delete(':id')
    async remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.quotationsService.remove(tenant.tenantId, id);
    }
}
