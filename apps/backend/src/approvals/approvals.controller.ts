import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ApprovalsService } from './approvals.service';
import { ApproveDto, RejectDto } from './approvals.dto';

/** Anyone who approves anything; the service narrows it to the kinds they may. */
const ANY_APPROVER = [
    StorePermission.MANAGE_HR,
    StorePermission.APPROVE_PRODUCT_DEMAND,
    StorePermission.APPROVE_GOODS_TRANSFER,
    StorePermission.APPROVE_VOUCHER,
];

@Controller('approvals')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ApprovalsController {
    constructor(private readonly approvals: ApprovalsService) {}

    @RequireAnyStorePermission(...ANY_APPROVER)
    @Get('inbox')
    inbox(@Tenant() tenant: TenantContext) {
        return this.approvals.inbox(tenant);
    }

    @RequireAnyStorePermission(...ANY_APPROVER)
    @HttpCode(HttpStatus.OK)
    @Post(':kind/:id/approve')
    approve(@Tenant() tenant: TenantContext, @Param('kind') kind: string, @Param('id') id: string, @Body() dto: ApproveDto) {
        return this.approvals.approve(tenant, kind, id, dto.note);
    }

    @RequireAnyStorePermission(...ANY_APPROVER)
    @HttpCode(HttpStatus.OK)
    @Post(':kind/:id/reject')
    reject(@Tenant() tenant: TenantContext, @Param('kind') kind: string, @Param('id') id: string, @Body() dto: RejectDto) {
        return this.approvals.reject(tenant, kind, id, dto.reason);
    }
}
