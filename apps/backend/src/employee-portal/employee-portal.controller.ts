import {
    Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Request, UseGuards,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { UseInterceptors } from '@nestjs/common';
import { EmployeeGuard } from './employee.guard';
import { EmployeePortalService } from './employee-portal.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadedFile } from '@nestjs/common';
import { ApplyForLeaveDto, ClockDto, PortalPeriodQueryDto } from './employee-portal.dto';
import { CreateExpenseClaimDto, UpdateExpenseClaimDto } from '../expense-claims/expense-claims.dto';

/**
 * The employee's own screens. Every handler reads `req.employee`, populated by
 * `EmployeeGuard` from the token — no handler takes an employee id.
 */
@Controller('employee-portal')
@UseGuards(JwtAuthGuard, EmployeeGuard)
export class EmployeePortalController {
    constructor(private readonly service: EmployeePortalService) {}

    @Get('me')
    getProfile(@Request() req: any) {
        return { employee: req.employee };
    }

    @Get('summary')
    getSummary(@Request() req: any, @Query() query: PortalPeriodQueryDto) {
        return this.service.getSummary(
            req.employee.tenant_id, req.employee.id, query.year, query.month,
        );
    }

    @Get('attendance/today')
    today(@Request() req: any) {
        return this.service.today(req.employee.tenant_id, req.employee.id);
    }

    @Post('attendance/check-in')
    @HttpCode(HttpStatus.OK)
    checkIn(@Request() req: any, @Body() dto: ClockDto) {
        return this.service.checkIn(req.employee.tenant_id, req.employee.id, dto);
    }

    @Post('attendance/check-out')
    @HttpCode(HttpStatus.OK)
    checkOut(@Request() req: any, @Body() dto: ClockDto) {
        return this.service.checkOut(req.employee.tenant_id, req.employee.id, dto);
    }

    @Get('attendance')
    listAttendance(@Request() req: any, @Query() query: PortalPeriodQueryDto) {
        return this.service.listAttendance(
            req.employee.tenant_id, req.employee.id, query.year, query.month,
        );
    }

    @Get('leave-balances')
    listLeaveBalances(@Request() req: any, @Query() query: PortalPeriodQueryDto) {
        return this.service.listLeaveBalances(req.employee.tenant_id, req.employee.id, query.year);
    }

    @Get('leave-requests')
    listLeaveRequests(@Request() req: any) {
        return this.service.listLeaveRequests(req.employee.tenant_id, req.employee.id);
    }

    @Post('leave-requests')
    applyForLeave(@Request() req: any, @Body() dto: ApplyForLeaveDto) {
        return this.service.applyForLeave(req.employee.tenant_id, req.employee.id, dto);
    }

    @Patch('leave-requests/:id/cancel')
    cancelLeaveRequest(@Request() req: any, @Param('id') id: string) {
        return this.service.cancelLeaveRequest(req.employee.tenant_id, req.employee.id, id);
    }

    @Get('payslips')
    listPayslips(@Request() req: any) {
        return this.service.listPayslips(req.employee.tenant_id, req.employee.id);
    }

    @Get('payslips/:runId')
    getPayslip(@Request() req: any, @Param('runId') runId: string) {
        return this.service.getPayslip(req.employee.tenant_id, req.employee.id, runId);
    }

    // ── Expense claims ────────────────────────────────────────────────────────

    @Get('expense-claims')
    listClaims(@Request() req: any) {
        return this.service.listClaims(req.employee.tenant_id, req.employee.id);
    }

    @Get('expense-claims/:id')
    getClaim(@Request() req: any, @Param('id') id: string) {
        return this.service.getClaim(req.employee.tenant_id, req.employee.id, id);
    }

    @Post('expense-claims')
    createClaim(@Request() req: any, @Body() dto: CreateExpenseClaimDto) {
        return this.service.createClaim(req.employee.tenant_id, req.employee.id, dto);
    }

    @Patch('expense-claims/:id')
    updateClaim(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateExpenseClaimDto) {
        return this.service.updateClaim(req.employee.tenant_id, req.employee.id, id, dto);
    }

    @Patch('expense-claims/:id/submit')
    submitClaim(@Request() req: any, @Param('id') id: string) {
        return this.service.submitClaim(req.employee.tenant_id, req.employee.id, id);
    }

    @Patch('expense-claims/:id/cancel')
    cancelClaim(@Request() req: any, @Param('id') id: string) {
        return this.service.cancelClaim(req.employee.tenant_id, req.employee.id, id);
    }

    @Post('expense-claims/:id/attachments')
    @UseInterceptors(FileInterceptor('file'))
    addClaimAttachment(@Request() req: any, @Param('id') id: string, @UploadedFile() file: any) {
        return this.service.addClaimAttachment(
            req.employee.tenant_id, req.employee.id, id, file, req.user?.userId,
        );
    }

    @Delete('expense-claims/attachments/:attachmentId')
    @HttpCode(HttpStatus.NO_CONTENT)
    removeClaimAttachment(@Request() req: any, @Param('attachmentId') attachmentId: string) {
        return this.service.removeClaimAttachment(
            req.employee.tenant_id, req.employee.id, attachmentId,
        );
    }

    // ── Assets, policies and documents ────────────────────────────────────────

    @Get('assets')
    listMyAssets(@Request() req: any) {
        return this.service.listMyAssets(req.employee.tenant_id, req.employee.id);
    }

    @Patch('assets/:id/acknowledge')
    acknowledgeAsset(@Request() req: any, @Param('id') id: string) {
        return this.service.acknowledgeAsset(req.employee.tenant_id, req.employee.id, id);
    }

    @Get('policies')
    listMyPolicies(@Request() req: any) {
        return this.service.listMyPolicies(req.employee.tenant_id, req.employee.id);
    }

    @Patch('policies/:id/acknowledge')
    acknowledgePolicy(@Request() req: any, @Param('id') id: string) {
        return this.service.acknowledgePolicy(req.employee.tenant_id, req.employee.id, id);
    }

    @Get('documents')
    listMyDocuments(@Request() req: any) {
        return this.service.listMyDocuments(req.employee.tenant_id, req.employee.id);
    }

    @Get('salary-payments')
    listSalaryPayments(@Request() req: any) {
        return this.service.listSalaryPayments(req.employee.tenant_id, req.employee.id);
    }
}

/**
 * The admin half — granting and revoking portal access — kept in its own
 * controller because it is guarded the other way round: `MANAGE_HR` on a staff
 * token, not `EmployeeGuard` on an employee's.
 *
 * Mounted under `/employees` so it sits with the rest of employee
 * administration rather than under the portal an admin never uses.
 */
@Controller('employees')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.MANAGE_HR)
@UseInterceptors(TenantInterceptor)
export class EmployeePortalAdminController {
    constructor(private readonly service: EmployeePortalService) {}

    @Post(':id/portal-access')
    @HttpCode(HttpStatus.OK)
    grant(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.setPortalAccess(tenant.tenantId, id, true);
    }

    @Patch(':id/portal-access/revoke')
    revoke(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.setPortalAccess(tenant.tenantId, id, false);
    }
}
