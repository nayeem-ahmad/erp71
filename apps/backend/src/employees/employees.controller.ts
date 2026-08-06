import {
    Controller, Get, Post, Patch, Delete, Body, Param, Query,
    UseGuards, UseInterceptors, HttpCode, HttpStatus,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import {
    CreateEmployeeDto, UpdateEmployeeDto,
    CreateDepartmentDto, UpdateDepartmentDto,
    CreateDesignationDto, UpdateDesignationDto,
    LinkUserDto,
} from './employee.dto';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ImportRowsDto } from '../common/import.dto';

/**
 * `VIEW_HR` gates reading the roster; `MANAGE_HR` gates changing it. Salary
 * figures need `VIEW_PAYROLL` on top and are stripped in the service, not
 * refused, so a user with `VIEW_HR` alone sees the employee without the money.
 *
 * Until Phase 0 of the HRIS plan this controller guarded with `JwtAuthGuard`
 * alone, so any authenticated user in the tenant could read every salary. The
 * roster itself was already carried to existing managers by the `hr` group in
 * `sync-role-permissions.ts`; `MANAGE_HR` ships with its own group because that
 * script skips a group whose permissions a role already partly holds.
 */
@Controller('employees')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.VIEW_HR)
@UseInterceptors(TenantInterceptor)
export class EmployeesController {
    constructor(private readonly employeesService: EmployeesService) {}

    // ── Departments ───────────────────────────────────────────────────────────

    @Get('departments')
    listDepartments(@Tenant() tenant: TenantContext) {
        return this.employeesService.listDepartments(tenant.tenantId);
    }

    @Post('departments')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    createDepartment(@Tenant() tenant: TenantContext, @Body() dto: CreateDepartmentDto) {
        return this.employeesService.createDepartment(tenant.tenantId, dto);
    }

    @Patch('departments/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    updateDepartment(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
        return this.employeesService.updateDepartment(tenant.tenantId, id, dto);
    }

    @Delete('departments/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteDepartment(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.employeesService.deleteDepartment(tenant.tenantId, id);
    }

    // ── Designations ──────────────────────────────────────────────────────────

    @Get('designations')
    listDesignations(@Tenant() tenant: TenantContext) {
        return this.employeesService.listDesignations(tenant.tenantId);
    }

    @Post('designations')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    createDesignation(@Tenant() tenant: TenantContext, @Body() dto: CreateDesignationDto) {
        return this.employeesService.createDesignation(tenant.tenantId, dto);
    }

    @Patch('designations/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    updateDesignation(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateDesignationDto) {
        return this.employeesService.updateDesignation(tenant.tenantId, id, dto);
    }

    @Delete('designations/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteDesignation(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.employeesService.deleteDesignation(tenant.tenantId, id);
    }

    // ── Employees ─────────────────────────────────────────────────────────────

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_HR)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateEmployeeDto) {
        return this.employeesService.create(tenant.tenantId, dto, tenant);
    }

    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('search') search?: string,
        @Query('status') status?: string,
        @Query('departmentId') departmentId?: string,
    ) {
        return this.employeesService.findAll(tenant.tenantId, {
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            search,
            status,
            departmentId,
        }, tenant);
    }

    @Post('import')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.employeesService.importRows(tenant.tenantId, body.rows, body.mode);
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.employeesService.findOne(tenant.tenantId, id, tenant);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
        return this.employeesService.update(tenant.tenantId, id, dto, tenant);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.employeesService.remove(tenant.tenantId, id);
    }

    @Post(':id/link-user')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    linkUser(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: LinkUserDto) {
        return this.employeesService.linkUser(tenant.tenantId, id, dto.user_id);
    }

    @Delete(':id/link-user')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.OK)
    unlinkUser(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.employeesService.unlinkUser(tenant.tenantId, id);
    }
}
