import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ProjectsService } from './projects.service';
import { ProjectSettingsService } from './project-settings.service';
import { ProjectTimeService } from './project-time.service';
import {
    CreateMilestoneDto,
    CreateProjectDto,
    CreateProjectTypeDto,
    CreateTaskStatusDto,
    ListProjectsDto,
    UpdateMilestoneDto,
    UpdateProjectDto,
    UpdateProjectTypeDto,
    UpdateTaskStatusDto,
    UpsertProjectMemberDto,
} from './project.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ProjectsController {
    constructor(
        private readonly projects: ProjectsService,
        private readonly settings: ProjectSettingsService,
        private readonly time: ProjectTimeService,
    ) {}

    // Settings routes come first: `types` and `task-statuses` would otherwise
    // be swallowed by the `:id` parameter route below.

    @Get('types')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    listTypes(@Tenant() tenant: TenantContext, @Query('includeInactive') includeInactive?: string) {
        return this.settings.listProjectTypes(tenant.tenantId, includeInactive === 'true');
    }

    @Post('types')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    createType(@Tenant() tenant: TenantContext, @Body() dto: CreateProjectTypeDto) {
        return this.settings.createProjectType(tenant.tenantId, dto);
    }

    @Patch('types/:id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    updateType(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateProjectTypeDto,
    ) {
        return this.settings.updateProjectType(tenant.tenantId, id, dto);
    }

    @Delete('types/:id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    removeType(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.settings.removeProjectType(tenant.tenantId, id);
    }

    @Get('task-statuses')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    listTaskStatuses(
        @Tenant() tenant: TenantContext,
        @Query('includeInactive') includeInactive?: string,
    ) {
        return this.settings.listTaskStatuses(tenant.tenantId, includeInactive === 'true');
    }

    @Post('task-statuses')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    createTaskStatus(@Tenant() tenant: TenantContext, @Body() dto: CreateTaskStatusDto) {
        return this.settings.createTaskStatus(tenant.tenantId, dto);
    }

    @Patch('task-statuses/:id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    updateTaskStatus(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateTaskStatusDto,
    ) {
        return this.settings.updateTaskStatus(tenant.tenantId, id, dto);
    }

    @Delete('task-statuses/:id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    removeTaskStatus(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.settings.removeTaskStatus(tenant.tenantId, id);
    }

    // ── Projects ───────────────────────────────────────────────────────────

    @Get()
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    list(@Tenant() tenant: TenantContext, @Query() query: ListProjectsDto) {
        return this.projects.list(tenant.tenantId, query);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateProjectDto) {
        return this.projects.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get(':id')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.projects.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateProjectDto,
    ) {
        return this.projects.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.projects.remove(tenant.tenantId, id);
    }

    @Get(':id/time-summary')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    timeSummary(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.time.summary(tenant.tenantId, id);
    }

    // ── Members ────────────────────────────────────────────────────────────

    @Post(':id/members')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    addMember(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpsertProjectMemberDto,
    ) {
        return this.projects.addMember(tenant.tenantId, id, dto);
    }

    @Delete(':id/members/:userId')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    removeMember(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('userId') userId: string,
    ) {
        return this.projects.removeMember(tenant.tenantId, id, userId);
    }

    // ── Milestones ─────────────────────────────────────────────────────────

    @Post(':id/milestones')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    createMilestone(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CreateMilestoneDto,
    ) {
        return this.projects.createMilestone(tenant.tenantId, id, dto);
    }

    @Patch('milestones/:milestoneId')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    updateMilestone(
        @Tenant() tenant: TenantContext,
        @Param('milestoneId') milestoneId: string,
        @Body() dto: UpdateMilestoneDto,
    ) {
        return this.projects.updateMilestone(tenant.tenantId, milestoneId, dto);
    }

    @Delete('milestones/:milestoneId')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    removeMilestone(
        @Tenant() tenant: TenantContext,
        @Param('milestoneId') milestoneId: string,
    ) {
        return this.projects.removeMilestone(tenant.tenantId, milestoneId);
    }
}
