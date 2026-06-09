import {
    Controller, Get, Post, Patch, Delete, Body, Param, Query,
    UseGuards, UseInterceptors, HttpCode, HttpStatus,
} from '@nestjs/common';
import { EmployeesService } from './employees.service';
import {
    CreateEmployeeDto, UpdateEmployeeDto,
    CreateDepartmentDto, CreateDesignationDto, LinkUserDto,
} from './employee.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('employees')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class EmployeesController {
    constructor(private readonly employeesService: EmployeesService) {}

    // ── Departments ───────────────────────────────────────────────────────────

    @Get('departments')
    listDepartments(@Tenant() tenant: TenantContext) {
        return this.employeesService.listDepartments(tenant.tenantId);
    }

    @Post('departments')
    createDepartment(@Tenant() tenant: TenantContext, @Body() dto: CreateDepartmentDto) {
        return this.employeesService.createDepartment(tenant.tenantId, dto);
    }

    // ── Designations ──────────────────────────────────────────────────────────

    @Get('designations')
    listDesignations(@Tenant() tenant: TenantContext) {
        return this.employeesService.listDesignations(tenant.tenantId);
    }

    @Post('designations')
    createDesignation(@Tenant() tenant: TenantContext, @Body() dto: CreateDesignationDto) {
        return this.employeesService.createDesignation(tenant.tenantId, dto);
    }

    // ── Employees ─────────────────────────────────────────────────────────────

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateEmployeeDto) {
        return this.employeesService.create(tenant.tenantId, dto);
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
        });
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.employeesService.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
        return this.employeesService.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.employeesService.remove(tenant.tenantId, id);
    }

    @Post(':id/link-user')
    linkUser(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: LinkUserDto) {
        return this.employeesService.linkUser(tenant.tenantId, id, dto.user_id);
    }

    @Delete(':id/link-user')
    @HttpCode(HttpStatus.OK)
    unlinkUser(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.employeesService.unlinkUser(tenant.tenantId, id);
    }
}
