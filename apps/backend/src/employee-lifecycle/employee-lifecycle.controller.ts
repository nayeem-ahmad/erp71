import {
    Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query,
    UseGuards, UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { EmployeeLifecycleService } from './employee-lifecycle.service';
import {
    CompleteChecklistItemDto, CreateChecklistTemplateDto, PrepareSettlementDto,
    RecordExitDto, StartChecklistDto,
} from './employee-lifecycle.dto';

@Controller('hr/lifecycle')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.VIEW_HR)
@UseInterceptors(TenantInterceptor)
export class EmployeeLifecycleController {
    constructor(private readonly service: EmployeeLifecycleService) {}

    @Get('checklist-templates')
    listTemplates(@Tenant() tenant: TenantContext, @Query('kind') kind?: string) {
        return this.service.listTemplates(tenant.tenantId, kind);
    }

    @Post('checklist-templates')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    createTemplate(@Tenant() tenant: TenantContext, @Body() dto: CreateChecklistTemplateDto) {
        return this.service.createTemplate(tenant.tenantId, dto as any);
    }

    @Delete('checklist-templates/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteTemplate(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.deleteTemplate(tenant.tenantId, id);
    }

    @Get('employees/:employeeId/checklist')
    listChecklist(
        @Tenant() tenant: TenantContext,
        @Param('employeeId') employeeId: string,
        @Query('kind') kind?: string,
    ) {
        return this.service.listChecklist(tenant.tenantId, employeeId, kind);
    }

    @Post('employees/:employeeId/checklist')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.OK)
    startChecklist(
        @Tenant() tenant: TenantContext,
        @Param('employeeId') employeeId: string,
        @Body() dto: StartChecklistDto,
    ) {
        return this.service.startChecklist(tenant.tenantId, employeeId, dto.kind);
    }

    @Patch('checklist-items/:id/complete')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    completeItem(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CompleteChecklistItemDto,
    ) {
        return this.service.completeChecklistItem(tenant.tenantId, id, tenant.userId, dto.notes);
    }

    @Post('employees/:employeeId/exit')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.OK)
    recordExit(
        @Tenant() tenant: TenantContext,
        @Param('employeeId') employeeId: string,
        @Body() dto: RecordExitDto,
    ) {
        return this.service.recordExit(tenant.tenantId, employeeId, dto);
    }

    /** Final settlement is money, so it needs VIEW_PAYROLL on top of VIEW_HR. */
    @Get('employees/:employeeId/final-settlement')
    @RequireStorePermission(StorePermission.VIEW_PAYROLL)
    previewSettlement(@Tenant() tenant: TenantContext, @Param('employeeId') employeeId: string) {
        return this.service.previewFinalSettlement(tenant.tenantId, employeeId);
    }

    @Post('employees/:employeeId/final-settlement')
    @RequireStorePermission(StorePermission.VIEW_PAYROLL, StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.OK)
    prepareSettlement(
        @Tenant() tenant: TenantContext,
        @Param('employeeId') employeeId: string,
        @Body() dto: PrepareSettlementDto,
    ) {
        return this.service.prepareFinalSettlement(tenant.tenantId, employeeId, dto, tenant.userId);
    }
}
