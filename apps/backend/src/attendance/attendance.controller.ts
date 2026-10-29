import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    UseInterceptors,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequiresPlan } from '../auth/subscription-access.decorator';
import { AttendanceService } from './attendance.service';
import { AttendanceCaptureService } from './attendance-capture.service';
import { AttendancePunchService } from './attendance-punch.service';
import { OvertimeService } from './overtime.service';
import {
    CreatePunchDto,
    MonthQueryDto,
    OvertimeQueryDto,
    PunchQueryDto,
    ReviewOvertimeDto,
    UpdateAttendanceSettingsDto,
    UpdatePunchDto,
    UpsertAttendanceDto,
    CreateLeaveTypeDto,
    UpdateLeaveTypeDto,
    SetLeaveBalanceDto,
    CreateLeaveRequestDto,
    ReviewLeaveRequestDto,
} from './attendance.dto';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { HR_READ, HR_WRITE } from '../auth/permission-sets';
import { BranchScopeService } from '../database/branch-scope.service';
@Controller('attendance')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@RequiresPlan('STANDARD')
@UseInterceptors(TenantInterceptor)
export class AttendanceController {
    constructor(
        private svc: AttendanceService,
        private capture: AttendanceCaptureService,
        private punches: AttendancePunchService,
        private overtime: OvertimeService,
        private branchScope: BranchScopeService,
    ) {}

    /** Header branch for a member; every branch for someone who can see them all. */
    private homeBranch(tenant: TenantContext, requested?: string) {
        return this.branchScope.resolveStoreId(tenant, requested, { permissions: HR_READ });
    }

    // ── In/out records ────────────────────────────────────────────────────────
    //
    // Declared above the bare `:id` routes below: Nest matches in declaration
    // order, so `DELETE /attendance/punches/x` would otherwise be read as a
    // delete of the attendance record with id `punches`.

    @RequireAnyStorePermission(...HR_READ)
    @Get('punches')
    async listPunches(@Tenant() tenant: TenantContext, @Query() query: PunchQueryDto) {
        const storeId = await this.homeBranch(tenant, query.storeId);
        return this.punches.list(tenant.tenantId, { ...query, storeId });
    }

    /** One employee's punches for one day, with the summary they produce. */
    @RequireAnyStorePermission(...HR_READ)
    @Get('punches/day')
    listPunchDay(
        @Tenant() tenant: TenantContext,
        @Query('employeeId') employeeId: string,
        @Query('date') date: string,
    ) {
        return this.punches.listDay(tenant.tenantId, employeeId, date);
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Post('punches')
    createPunch(@Tenant() tenant: TenantContext, @Body() dto: CreatePunchDto) {
        return this.punches.create(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Patch('punches/:id')
    async updatePunch(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdatePunchDto,
    ) {
        const storeId = await this.homeBranch(tenant);
        return this.punches.update(tenant.tenantId, id, dto, storeId);
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Delete('punches/:id')
    @HttpCode(HttpStatus.OK)
    async deletePunch(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        const storeId = await this.homeBranch(tenant);
        return this.punches.remove(tenant.tenantId, id, storeId);
    }

    // ── Overtime & monthly snapshot ───────────────────────────────────────────

    @RequireAnyStorePermission(...HR_READ)
    @Get('overtime')
    async listOvertime(@Tenant() tenant: TenantContext, @Query() query: OvertimeQueryDto) {
        const storeId = await this.homeBranch(tenant, query.storeId);
        return this.overtime.list(tenant.tenantId, { ...query, storeId });
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Post('overtime/generate')
    @HttpCode(HttpStatus.OK)
    async generateOvertime(@Tenant() tenant: TenantContext, @Body() dto: MonthQueryDto) {
        const storeId = await this.homeBranch(tenant);
        return this.overtime.generateForMonth(tenant.tenantId, dto.year, dto.month, storeId);
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Patch('overtime/:id/review')
    async reviewOvertime(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: ReviewOvertimeDto,
    ) {
        const storeId = await this.homeBranch(tenant);
        return this.overtime.review(tenant.tenantId, id, tenant.userId, dto, storeId);
    }

    @RequireAnyStorePermission(...HR_READ)
    @Get('month-snapshot')
    async listSnapshots(@Tenant() tenant: TenantContext, @Query() query: MonthQueryDto) {
        const storeId = await this.homeBranch(tenant);
        return this.overtime.listSnapshots(tenant.tenantId, query.year, query.month, storeId);
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Post('month-snapshot/build')
    @HttpCode(HttpStatus.OK)
    async buildSnapshots(@Tenant() tenant: TenantContext, @Body() dto: MonthQueryDto) {
        const storeId = await this.homeBranch(tenant);
        return this.overtime.buildSnapshots(tenant.tenantId, dto.year, dto.month, storeId);
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Post('month-snapshot/freeze')
    @HttpCode(HttpStatus.OK)
    freezeMonth(@Tenant() tenant: TenantContext, @Body() dto: MonthQueryDto) {
        return this.overtime.freezeMonth(tenant.tenantId, dto.year, dto.month);
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Post('month-snapshot/unfreeze')
    @HttpCode(HttpStatus.OK)
    unfreezeMonth(@Tenant() tenant: TenantContext, @Body() dto: MonthQueryDto) {
        return this.overtime.unfreezeMonth(tenant.tenantId, dto.year, dto.month);
    }

    // ── Leave calendar & carry-forward (Phase 11) ─────────────────────────────

    /**
     * Who might be off between two dates. Approved and pending both — the
     * question a manager is asking is not "who is definitely off".
     */
    @RequireAnyStorePermission(...HR_READ)
    @Get('leave-calendar')
    async leaveCalendar(
        @Tenant() tenant: TenantContext,
        @Query('from') from: string,
        @Query('to') to: string,
    ) {
        const storeId = await this.homeBranch(tenant);
        return this.svc.getLeaveCalendar(tenant.tenantId, from, to, storeId);
    }

    /**
     * Roll unused balances into next year, capped per leave type.
     *
     * Safe to re-run: the carried figure is set, not incremented.
     */
    @RequireAnyStorePermission(...HR_WRITE)
    @Post('leave-carry-forward')
    @HttpCode(HttpStatus.OK)
    carryForward(@Tenant() tenant: TenantContext, @Body() body: { year: number }) {
        return this.svc.runCarryForward(tenant.tenantId, body.year);
    }

    // ── Settings ──────────────────────────────────────────────────────────────

    /**
     * Attendance policy for the tenant. Readable by anyone who can reach this
     * controller — an employee needs to know whether self check-in is on to
     * render the button, and none of these fields are sensitive.
     */
    @RequireAnyStorePermission(...HR_READ)
    @Get('settings')
    getSettings(@Tenant() tenant: TenantContext) {
        return this.capture.getSettings(tenant.tenantId);
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Patch('settings')
    updateSettings(@Tenant() tenant: TenantContext, @Body() dto: UpdateAttendanceSettingsDto) {
        return this.capture.updateSettings(tenant.tenantId, dto);
    }

    // ── Leave Types ───────────────────────────────────────────────────────────

    @RequireAnyStorePermission(...HR_READ)
    @Get('leave-types')
    listLeaveTypes(@Tenant() tenant: TenantContext) {
        return this.svc.listLeaveTypes(tenant.tenantId);
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Post('leave-types')
    createLeaveType(@Tenant() tenant: TenantContext, @Body() dto: CreateLeaveTypeDto) {
        return this.svc.createLeaveType(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Patch('leave-types/:id')
    updateLeaveType(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateLeaveTypeDto,
    ) {
        return this.svc.updateLeaveType(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Delete('leave-types/:id')
    @HttpCode(HttpStatus.OK)
    deleteLeaveType(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.svc.deleteLeaveType(tenant.tenantId, id);
    }

    // ── Attendance Records ────────────────────────────────────────────────────

    @RequireAnyStorePermission(...HR_WRITE)
    @Post()
    upsertAttendance(@Tenant() tenant: TenantContext, @Body() dto: UpsertAttendanceDto) {
        return this.svc.upsertAttendance(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...HR_READ)
    @Get()
    async listAttendance(
        @Tenant() tenant: TenantContext,
        @Query('employeeId') employeeId?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('status') status?: string,
        @Query('storeId') storeId?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const branchId = await this.homeBranch(tenant, storeId);
        return this.svc.listAttendance(tenant.tenantId, {
            employeeId,
            startDate,
            endDate,
            status,
            storeId: branchId,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    @RequireAnyStorePermission(...HR_READ)
    @Get('summary/:employeeId')
    getAttendanceSummary(
        @Tenant() tenant: TenantContext,
        @Param('employeeId') employeeId: string,
        @Query('year') year: string,
        @Query('month') month: string,
    ) {
        return this.svc.getEmployeeAttendanceSummary(
            tenant.tenantId,
            employeeId,
            parseInt(year, 10),
            parseInt(month, 10),
        );
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Delete(':id')
    @HttpCode(HttpStatus.OK)
    deleteAttendance(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.svc.deleteAttendance(tenant.tenantId, id);
    }

    // ── Leave Balances ────────────────────────────────────────────────────────

    @RequireAnyStorePermission(...HR_READ)
    @Get('leave-balances/:employeeId')
    listLeaveBalances(@Tenant() tenant: TenantContext, @Param('employeeId') employeeId: string) {
        return this.svc.listLeaveBalances(tenant.tenantId, employeeId);
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Post('leave-balances')
    setLeaveBalance(@Tenant() tenant: TenantContext, @Body() dto: SetLeaveBalanceDto) {
        return this.svc.setLeaveBalance(tenant.tenantId, dto);
    }

    // ── Leave Requests ────────────────────────────────────────────────────────

    @RequireAnyStorePermission(...HR_WRITE)
    @Post('leave-requests')
    createLeaveRequest(@Tenant() tenant: TenantContext, @Body() dto: CreateLeaveRequestDto) {
        return this.svc.createLeaveRequest(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...HR_READ)
    @Get('leave-requests')
    async listLeaveRequests(
        @Tenant() tenant: TenantContext,
        @Query('employeeId') employeeId?: string,
        @Query('status') status?: string,
        @Query('storeId') storeId?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const branchId = await this.homeBranch(tenant, storeId);
        return this.svc.listLeaveRequests(tenant.tenantId, {
            employeeId,
            status,
            storeId: branchId,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Patch('leave-requests/:id/review')
    async reviewLeaveRequest(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: ReviewLeaveRequestDto,
    ) {
        const storeId = await this.homeBranch(tenant);
        return this.svc.reviewLeaveRequest(tenant.tenantId, id, tenant.userId, dto, storeId);
    }

    @RequireAnyStorePermission(...HR_WRITE)
    @Patch('leave-requests/:id/cancel')
    async cancelLeaveRequest(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        const storeId = await this.homeBranch(tenant);
        return this.svc.cancelLeaveRequest(tenant.tenantId, id, undefined, storeId);
    }
}
