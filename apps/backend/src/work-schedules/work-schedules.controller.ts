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
import { WorkSchedulesService } from './work-schedules.service';
import {
    AssignScheduleDto, CreateHolidayDto, CreateWorkScheduleDto, HolidayQueryDto,
    UpdateHolidayDto, UpdateWorkScheduleDto,
} from './work-schedules.dto';

/**
 * Reading the calendar needs `VIEW_HR`; changing it needs `MANAGE_HR`. Same
 * split as the employee roster — a shift pattern is roster data.
 */
@Controller('hr')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.VIEW_HR)
@UseInterceptors(TenantInterceptor)
export class WorkSchedulesController {
    constructor(private readonly service: WorkSchedulesService) {}

    // ── Holidays ──────────────────────────────────────────────────────────────

    @Get('holidays')
    listHolidays(@Tenant() tenant: TenantContext, @Query() query: HolidayQueryDto) {
        return this.service.listHolidays(tenant.tenantId, query.year);
    }

    @Post('holidays')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    createHoliday(@Tenant() tenant: TenantContext, @Body() dto: CreateHolidayDto) {
        return this.service.createHoliday(tenant.tenantId, dto);
    }

    @Patch('holidays/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    updateHoliday(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateHolidayDto) {
        return this.service.updateHoliday(tenant.tenantId, id, dto);
    }

    @Delete('holidays/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteHoliday(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.deleteHoliday(tenant.tenantId, id);
    }

    // ── Schedules ─────────────────────────────────────────────────────────────

    @Get('work-schedules')
    listSchedules(@Tenant() tenant: TenantContext) {
        return this.service.listSchedules(tenant.tenantId);
    }

    @Post('work-schedules')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    createSchedule(@Tenant() tenant: TenantContext, @Body() dto: CreateWorkScheduleDto) {
        return this.service.createSchedule(tenant.tenantId, dto);
    }

    @Get('work-schedules/:id')
    getSchedule(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.getSchedule(tenant.tenantId, id);
    }

    @Patch('work-schedules/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    updateSchedule(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateWorkScheduleDto) {
        return this.service.updateSchedule(tenant.tenantId, id, dto);
    }

    @Delete('work-schedules/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    deleteSchedule(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.deleteSchedule(tenant.tenantId, id);
    }

    // ── Assignment ────────────────────────────────────────────────────────────

    @Post('work-schedules/assign')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.OK)
    assign(@Tenant() tenant: TenantContext, @Body() dto: AssignScheduleDto) {
        return this.service.assign(tenant.tenantId, dto);
    }

    @Get('employees/:employeeId/schedules')
    listAssignments(@Tenant() tenant: TenantContext, @Param('employeeId') employeeId: string) {
        return this.service.listAssignments(tenant.tenantId, employeeId);
    }
}
