import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AdminTenantsService } from './admin-tenants.service';
import {
    ListAdminTenantsQueryDto,
    ListAdminTenantLedgerQueryDto,
    UpdateAdminTenantSubscriptionDto,
    UpdateAdminTenantLocalizationDto,
    SuspendTenantDto,
    DeleteTenantDto,
    CreateAdminTenantDto,
    RecordTenantPaymentDto,
    RecordTenantRefundDto,
    AdminSellSmsCreditsDto,
    AdminSellAiCreditsDto,
} from './admin-tenants.dto';

@Controller('admin/tenants')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminTenantsController {
    constructor(private readonly adminTenantsService: AdminTenantsService) {}

    @Get()
    listTenants(@Query() query: ListAdminTenantsQueryDto) {
        return this.adminTenantsService.listTenants(query);
    }

    @Post()
    createTenant(
        @Body() dto: CreateAdminTenantDto,
        @Request() req: any,
    ) {
        return this.adminTenantsService.createTenant(dto, req.user.userId);
    }

    @Get('ledger')
    listLedger(@Query() query: ListAdminTenantLedgerQueryDto) {
        return this.adminTenantsService.listTenantLedger(query);
    }

    @Get(':tenantId')
    getTenant(@Param('tenantId') tenantId: string) {
        return this.adminTenantsService.getTenant(tenantId);
    }

    @Patch(':tenantId/subscription')
    updateSubscription(
        @Param('tenantId') tenantId: string,
        @Body() dto: UpdateAdminTenantSubscriptionDto,
    ) {
        return this.adminTenantsService.updateSubscription(tenantId, dto);
    }

    @Patch(':tenantId/localization')
    updateLocalization(
        @Param('tenantId') tenantId: string,
        @Body() dto: UpdateAdminTenantLocalizationDto,
        @Request() req: any,
    ) {
        return this.adminTenantsService.updateLocalization(tenantId, dto, req.user.userId);
    }

    @Patch(':tenantId/suspend')
    suspendTenant(
        @Param('tenantId') tenantId: string,
        @Body() dto: SuspendTenantDto,
        @Request() req: any,
    ) {
        return this.adminTenantsService.suspendTenant(tenantId, dto, req.user.userId);
    }

    @Post(':tenantId/impersonate')
    impersonateTenant(
        @Param('tenantId') tenantId: string,
        @Request() req: any,
    ) {
        return this.adminTenantsService.impersonateTenant(tenantId, req.user.userId);
    }

    @Delete(':tenantId')
    deleteTenant(
        @Param('tenantId') tenantId: string,
        @Body() dto: DeleteTenantDto,
        @Request() req: any,
    ) {
        return this.adminTenantsService.deleteTenant(tenantId, dto, req.user.userId);
    }

    @Get(':tenantId/ledger')
    getTenantLedger(@Param('tenantId') tenantId: string) {
        return this.adminTenantsService.getTenantLedger(tenantId);
    }

    @Post(':tenantId/payments')
    recordPayment(
        @Param('tenantId') tenantId: string,
        @Body() dto: RecordTenantPaymentDto,
        @Request() req: any,
    ) {
        return this.adminTenantsService.recordPayment(tenantId, dto, req.user.userId);
    }

    @Post(':tenantId/refunds')
    recordRefund(
        @Param('tenantId') tenantId: string,
        @Body() dto: RecordTenantRefundDto,
        @Request() req: any,
    ) {
        return this.adminTenantsService.recordRefund(tenantId, dto, req.user.userId);
    }

    @Post(':tenantId/sms-credits')
    sellSmsCredits(
        @Param('tenantId') tenantId: string,
        @Body() dto: AdminSellSmsCreditsDto,
        @Request() req: any,
    ) {
        return this.adminTenantsService.sellSmsCredits(tenantId, dto, req.user.userId);
    }

    @Post(':tenantId/ai-credits')
    sellAiCredits(
        @Param('tenantId') tenantId: string,
        @Body() dto: AdminSellAiCreditsDto,
        @Request() req: any,
    ) {
        return this.adminTenantsService.sellAiCredits(tenantId, dto, req.user.userId);
    }
}
