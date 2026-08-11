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
import { RecruitmentService } from './recruitment.service';
import {
    ChangeStageDto, CreateApplicantDto, CreateApplicationDto, CreateJobPostDto,
    HireApplicationDto, ListApplicationsQueryDto, ListJobPostsQueryDto, UpdateApplicantDto,
    UpdateApplicationDto, UpdateJobPostDto,
} from './recruitment.dto';

/**
 * Recruitment sits under the HR permissions rather than its own pair: whoever
 * runs employees runs hiring, and a separate permission would have to be granted
 * to every existing HR role before the module did anything for anyone.
 */
@Controller('hr/recruitment')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.VIEW_HR)
@UseInterceptors(TenantInterceptor)
export class RecruitmentController {
    constructor(private readonly service: RecruitmentService) {}

    @Get('summary')
    summary(@Tenant() tenant: TenantContext) {
        return this.service.summary(tenant.tenantId);
    }

    // ── Job posts ─────────────────────────────────────────────────────────────

    @Get('job-posts')
    listJobPosts(@Tenant() tenant: TenantContext, @Query() query: ListJobPostsQueryDto) {
        return this.service.listJobPosts(tenant.tenantId, query);
    }

    @Get('job-posts/:id')
    getJobPost(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.getJobPost(tenant.tenantId, id);
    }

    @Post('job-posts')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    createJobPost(@Tenant() tenant: TenantContext, @Body() dto: CreateJobPostDto) {
        return this.service.createJobPost(tenant.tenantId, dto);
    }

    @Patch('job-posts/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    updateJobPost(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateJobPostDto,
    ) {
        return this.service.updateJobPost(tenant.tenantId, id, dto);
    }

    @Delete('job-posts/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    async deleteJobPost(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        await this.service.deleteJobPost(tenant.tenantId, id);
    }

    // ── Applicants ────────────────────────────────────────────────────────────

    @Get('applicants')
    listApplicants(@Tenant() tenant: TenantContext, @Query('search') search?: string) {
        return this.service.listApplicants(tenant.tenantId, { search });
    }

    @Get('applicants/:id')
    getApplicant(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.getApplicant(tenant.tenantId, id);
    }

    @Post('applicants')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    createApplicant(@Tenant() tenant: TenantContext, @Body() dto: CreateApplicantDto) {
        return this.service.createApplicant(tenant.tenantId, dto);
    }

    @Patch('applicants/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    updateApplicant(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateApplicantDto,
    ) {
        return this.service.updateApplicant(tenant.tenantId, id, dto);
    }

    @Delete('applicants/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    async deleteApplicant(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        await this.service.deleteApplicant(tenant.tenantId, id);
    }

    // ── Applications ──────────────────────────────────────────────────────────

    @Get('applications')
    listApplications(@Tenant() tenant: TenantContext, @Query() query: ListApplicationsQueryDto) {
        return this.service.listApplications(tenant.tenantId, query);
    }

    @Get('applications/:id')
    getApplication(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.getApplication(tenant.tenantId, id);
    }

    @Post('applications')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    createApplication(@Tenant() tenant: TenantContext, @Body() dto: CreateApplicationDto) {
        return this.service.createApplication(tenant.tenantId, dto, tenant.userId);
    }

    @Patch('applications/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    updateApplication(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateApplicationDto,
    ) {
        return this.service.updateApplication(tenant.tenantId, id, dto);
    }

    @Patch('applications/:id/stage')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    changeStage(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: ChangeStageDto,
    ) {
        return this.service.changeStage(tenant.tenantId, id, dto, tenant.userId);
    }

    /** Creates an employee, so it needs the permission that creating one needs. */
    @Post('applications/:id/hire')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.OK)
    hire(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: HireApplicationDto,
    ) {
        return this.service.hire(tenant.tenantId, id, dto, tenant);
    }

    @Delete('applications/:id')
    @RequireStorePermission(StorePermission.MANAGE_HR)
    @HttpCode(HttpStatus.NO_CONTENT)
    async deleteApplication(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        await this.service.deleteApplication(tenant.tenantId, id);
    }
}
