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
import { AttendanceService } from './attendance.service';
import {
    UpsertAttendanceDto,
    CreateLeaveTypeDto,
    UpdateLeaveTypeDto,
    SetLeaveBalanceDto,
    CreateLeaveRequestDto,
    ReviewLeaveRequestDto,
} from './attendance.dto';

@Controller('attendance')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class AttendanceController {
    constructor(private svc: AttendanceService) {}

    // ── Leave Types ───────────────────────────────────────────────────────────

    @Get('leave-types')
    listLeaveTypes(@Tenant() tenant: TenantContext) {
        return this.svc.listLeaveTypes(tenant.tenantId);
    }

    @Post('leave-types')
    createLeaveType(@Tenant() tenant: TenantContext, @Body() dto: CreateLeaveTypeDto) {
        return this.svc.createLeaveType(tenant.tenantId, dto);
    }

    @Patch('leave-types/:id')
    updateLeaveType(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateLeaveTypeDto,
    ) {
        return this.svc.updateLeaveType(tenant.tenantId, id, dto);
    }

    @Delete('leave-types/:id')
    @HttpCode(HttpStatus.OK)
    deleteLeaveType(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.svc.deleteLeaveType(tenant.tenantId, id);
    }

    // ── Attendance Records ────────────────────────────────────────────────────

    @Post()
    upsertAttendance(@Tenant() tenant: TenantContext, @Body() dto: UpsertAttendanceDto) {
        return this.svc.upsertAttendance(tenant.tenantId, dto);
    }

    @Get()
    listAttendance(
        @Tenant() tenant: TenantContext,
        @Query('employeeId') employeeId?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('status') status?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.svc.listAttendance(tenant.tenantId, {
            employeeId,
            startDate,
            endDate,
            status,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

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

    @Delete(':id')
    @HttpCode(HttpStatus.OK)
    deleteAttendance(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.svc.deleteAttendance(tenant.tenantId, id);
    }

    // ── Leave Balances ────────────────────────────────────────────────────────

    @Get('leave-balances/:employeeId')
    listLeaveBalances(@Tenant() tenant: TenantContext, @Param('employeeId') employeeId: string) {
        return this.svc.listLeaveBalances(tenant.tenantId, employeeId);
    }

    @Post('leave-balances')
    setLeaveBalance(@Tenant() tenant: TenantContext, @Body() dto: SetLeaveBalanceDto) {
        return this.svc.setLeaveBalance(tenant.tenantId, dto);
    }

    // ── Leave Requests ────────────────────────────────────────────────────────

    @Post('leave-requests')
    createLeaveRequest(@Tenant() tenant: TenantContext, @Body() dto: CreateLeaveRequestDto) {
        return this.svc.createLeaveRequest(tenant.tenantId, dto);
    }

    @Get('leave-requests')
    listLeaveRequests(
        @Tenant() tenant: TenantContext,
        @Query('employeeId') employeeId?: string,
        @Query('status') status?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.svc.listLeaveRequests(tenant.tenantId, {
            employeeId,
            status,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
    }

    @Patch('leave-requests/:id/review')
    reviewLeaveRequest(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: ReviewLeaveRequestDto,
    ) {
        return this.svc.reviewLeaveRequest(tenant.tenantId, id, tenant.userId, dto);
    }

    @Patch('leave-requests/:id/cancel')
    cancelLeaveRequest(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.svc.cancelLeaveRequest(tenant.tenantId, id);
    }
}
