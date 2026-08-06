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
import { EmployeeRecordsService } from './employee-records.service';
import {
    AddDocumentDto, AssignAssetDto, AssignmentQueryDto, CreatePolicyDto,
    ReturnAssetDto, UpdatePolicyDto,
} from './employee-records.dto';

@Controller('hr')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.VIEW_HR)
@UseInterceptors(TenantInterceptor)
export class EmployeeRecordsController {
    constructor(private readonly service: EmployeeRecordsService) {}

    // ── Asset assignments ─────────────────────────────────────────────────────

    @Get('asset-assignments')
    listAssignments(@Tenant() tenant: TenantContext, @Query() query: AssignmentQueryDto) {
        return this.service.listAssignments(tenant.tenantId, query);
    }

    @Post('asset-assignments')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    assign(@Tenant() tenant: TenantContext, @Body() dto: AssignAssetDto) {
        return this.service.assign(tenant.tenantId, dto as any, tenant.userId);
    }

    @Patch('asset-assignments/:id/return')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    recordReturn(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: ReturnAssetDto,
    ) {
        return this.service.recordReturn(tenant.tenantId, id, dto);
    }

    // ── Policies ──────────────────────────────────────────────────────────────

    @Get('policies')
    listPolicies(@Tenant() tenant: TenantContext) {
        return this.service.listPolicies(tenant.tenantId);
    }

    @Post('policies')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    createPolicy(@Tenant() tenant: TenantContext, @Body() dto: CreatePolicyDto) {
        return this.service.createPolicy(tenant.tenantId, dto as any, tenant.userId);
    }

    @Patch('policies/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    updatePolicy(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdatePolicyDto,
    ) {
        return this.service.updatePolicy(tenant.tenantId, id, dto as any);
    }

    @Delete('policies/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    deletePolicy(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.deletePolicy(tenant.tenantId, id);
    }

    @Get('policies/:id/acknowledgements')
    acknowledgementStatus(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.policyAcknowledgementStatus(tenant.tenantId, id);
    }

    // ── Employee documents ────────────────────────────────────────────────────

    @Get('employees/:employeeId/documents')
    listDocuments(@Tenant() tenant: TenantContext, @Param('employeeId') employeeId: string) {
        return this.service.listDocuments(tenant.tenantId, employeeId);
    }

    @Post('employees/:employeeId/documents')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @UseInterceptors(FileInterceptor('file'))
    addDocument(
        @Tenant() tenant: TenantContext,
        @Param('employeeId') employeeId: string,
        @Body() dto: AddDocumentDto,
        @UploadedFile() file: any,
    ) {
        return this.service.addDocument(tenant.tenantId, employeeId, dto, file, tenant.userId);
    }

    @Delete('documents/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteDocument(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.deleteDocument(tenant.tenantId, id);
    }

    @Get('documents/expiring')
    expiringDocuments(@Tenant() tenant: TenantContext, @Query('days') days?: string) {
        return this.service.expiringDocuments(tenant.tenantId, days ? parseInt(days, 10) : undefined);
    }
}
