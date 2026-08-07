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
import { SalaryStructuresService } from './salary-structures.service';
import {
    CreateSalaryComponentDto, ResolveStructureQueryDto, SetBankAccountDto,
    SetSalaryStructureDto, UpdateSalaryComponentDto,
} from './payroll.dto';

/**
 * Everything here is salary figures, so the whole controller needs
 * `VIEW_PAYROLL` — not `VIEW_HR`. A manager who can see the roster has no
 * business seeing what everyone is paid.
 */
@Controller('payroll')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.VIEW_PAYROLL)
@UseInterceptors(TenantInterceptor)
export class SalaryStructuresController {
    constructor(private readonly service: SalaryStructuresService) {}

    @Get('components')
    listComponents(@Tenant() tenant: TenantContext) {
        return this.service.listComponents(tenant.tenantId);
    }

    @Post('components/seed-defaults')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.OK)
    seedDefaults(@Tenant() tenant: TenantContext) {
        return this.service.ensureDefaultComponents(tenant.tenantId);
    }

    @Post('components')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    createComponent(@Tenant() tenant: TenantContext, @Body() dto: CreateSalaryComponentDto) {
        return this.service.createComponent(tenant.tenantId, dto as any);
    }

    @Patch('components/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    updateComponent(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateSalaryComponentDto,
    ) {
        return this.service.updateComponent(tenant.tenantId, id, dto as any);
    }

    @Delete('components/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteComponent(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.deleteComponent(tenant.tenantId, id);
    }

    @Get('structures/:employeeId')
    listStructures(@Tenant() tenant: TenantContext, @Param('employeeId') employeeId: string) {
        return this.service.listStructures(tenant.tenantId, employeeId);
    }

    @Get('structures/:employeeId/resolved')
    resolveStructure(
        @Tenant() tenant: TenantContext,
        @Param('employeeId') employeeId: string,
        @Query() query: ResolveStructureQueryDto,
    ) {
        return this.service.resolveStructure(
            tenant.tenantId, employeeId, query.on ? new Date(query.on) : new Date(),
        );
    }

    @Post('structures')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    setStructure(@Tenant() tenant: TenantContext, @Body() dto: SetSalaryStructureDto) {
        return this.service.setStructure(tenant.tenantId, dto as any, tenant.userId);
    }

    @Get('bank-accounts/:employeeId')
    getBankAccount(@Tenant() tenant: TenantContext, @Param('employeeId') employeeId: string) {
        return this.service.getBankAccount(tenant.tenantId, employeeId);
    }

    @Post('bank-accounts/:employeeId')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.OK)
    setBankAccount(
        @Tenant() tenant: TenantContext,
        @Param('employeeId') employeeId: string,
        @Body() dto: SetBankAccountDto,
    ) {
        return this.service.setBankAccount(tenant.tenantId, employeeId, dto as any);
    }
}
