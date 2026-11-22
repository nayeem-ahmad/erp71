import {
    Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Request, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission, RequireStorePermission } from '../auth/store-permission.decorator';
import { SALE_WRITE } from '../auth/permission-sets';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BranchScopeService } from '../database/branch-scope.service';
import { extractRequestMeta } from '../audit/audit-route.util';
import { ProjectBillingService } from './project-billing.service';
import { BillingQueryDto, BillRateDto, CreateProjectInvoiceDto } from './project.dto';

/**
 * Project costing, Phase C: billing the customer. Shares the `project-costing`
 * prefix with the costing routes; a module of its own because invoicing goes
 * through Sales, and the projects module must not depend on it.
 */
@Controller('project-costing')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ProjectBillingController {
    constructor(
        private readonly billing: ProjectBillingService,
        private readonly branchScope: BranchScopeService,
    ) {}

    @Get('billing-products')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS, StorePermission.VIEW_PROJECT_FINANCIALS)
    billingProducts(@Tenant() tenant: TenantContext) {
        return this.billing.billingProducts(tenant.tenantId);
    }

    @Get('projects/:projectId/billing')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS, StorePermission.VIEW_PROJECT_FINANCIALS)
    projectBilling(@Tenant() tenant: TenantContext, @Param('projectId') projectId: string, @Query() query: BillingQueryDto) {
        return this.billing.billing(tenant, projectId, query.upTo);
    }

    /**
     * An invoice is a credit sale, so raising one also needs what any sale
     * needs, in the branch it is raised in — checked the way converting a
     * quotation checks it.
     */
    @Post('projects/:projectId/invoices')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS, StorePermission.VIEW_PROJECT_FINANCIALS)
    @RequireAnyStorePermission(...SALE_WRITE)
    invoice(
        @Tenant() tenant: TenantContext,
        @Param('projectId') projectId: string,
        @Body() dto: CreateProjectInvoiceDto,
        @Request() req: any,
    ) {
        return this.billing.invoice(
            tenant,
            projectId,
            dto,
            { userId: tenant.userId, ...extractRequestMeta(req) },
            (storeId) =>
                this.branchScope
                    .resolveStoreId(tenant, storeId, { permissions: SALE_WRITE, allowAll: false })
                    .then(
                        () => true,
                        (error) => {
                            if (error instanceof ForbiddenException) return false;
                            throw error;
                        },
                    ),
        );
    }

    @Patch('projects/:projectId/members/:memberId/bill-rate')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS, StorePermission.VIEW_PROJECT_FINANCIALS)
    setBillRate(
        @Tenant() tenant: TenantContext,
        @Param('projectId') projectId: string,
        @Param('memberId') memberId: string,
        @Body() dto: BillRateDto,
        @Request() req: any,
    ) {
        return this.billing.setMemberBillRate(tenant, projectId, memberId, dto.billRate, {
            userId: tenant.userId,
            ...extractRequestMeta(req),
        });
    }
}
