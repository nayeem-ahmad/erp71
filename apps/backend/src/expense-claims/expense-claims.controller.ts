import {
    Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query,
    UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ExpenseClaimsService } from './expense-claims.service';
import {
    ExpenseClaimQueryDto, ReimburseExpenseClaimDto, ReviewExpenseClaimDto,
} from './expense-claims.dto';

/**
 * The staff side of expense claims: seeing everyone's, approving, reimbursing.
 * The employee's own side lives on the portal, where the employee id comes
 * from the token instead of a query string.
 */
@Controller('expense-claims')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.VIEW_HR)
@UseInterceptors(TenantInterceptor)
export class ExpenseClaimsController {
    constructor(private readonly service: ExpenseClaimsService) {}

    @Get()
    list(@Tenant() tenant: TenantContext, @Query() query: ExpenseClaimQueryDto) {
        return this.service.list(tenant.tenantId, query);
    }

    @Get(':id')
    get(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.get(tenant.tenantId, id);
    }

    @Patch(':id/review')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    review(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: ReviewExpenseClaimDto,
    ) {
        return this.service.review(tenant.tenantId, id, tenant.userId, dto);
    }

    @Post(':id/reimburse')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.OK)
    reimburse(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: ReimburseExpenseClaimDto,
    ) {
        return this.service.reimburse(tenant.tenantId, id, dto, tenant.userId);
    }

    @Post(':id/attachments')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @UseInterceptors(FileInterceptor('file'))
    addAttachment(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @UploadedFile() file: any,
    ) {
        return this.service.addAttachment(tenant.tenantId, id, undefined, file, tenant.userId);
    }

    @Delete('attachments/:attachmentId')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    removeAttachment(@Tenant() tenant: TenantContext, @Param('attachmentId') attachmentId: string) {
        return this.service.removeAttachment(tenant.tenantId, attachmentId);
    }
}
