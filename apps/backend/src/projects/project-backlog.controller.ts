import { Body, Controller, Get, Param, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ProjectBacklogService } from './project-backlog.service';
import {
    BulkBacklogScopeDto,
    BulkBacklogTasksDto,
    ReorderBacklogScopeDto,
    ReorderBacklogTasksDto,
} from './project.dto';

/**
 * Its own prefix rather than `projects/:id/backlog`, for the reason
 * `ProjectStoriesController` gives: `ProjectsController`'s literal routes
 * already have to be ordered around its `:id`.
 *
 * Writes are split by what they touch, because the permissions are: epics and
 * stories are scope (MANAGE_PROJECTS, as their own routes take), tasks are work
 * (MANAGE_PROJECT_TASKS). One route for both would have to grant whichever is
 * wider.
 */
@Controller('project-backlog')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ProjectBacklogController {
    constructor(private readonly backlog: ProjectBacklogService) {}

    /** Every visible project's epics and stories, for the cross-project screens. */
    @Get()
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    list(@Tenant() tenant: TenantContext) {
        return this.backlog.list(tenant);
    }

    @Get(':projectId')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    get(@Tenant() tenant: TenantContext, @Param('projectId') projectId: string) {
        return this.backlog.get(tenant, projectId);
    }

    @Patch(':projectId/scope/order')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    reorderScope(
        @Tenant() tenant: TenantContext,
        @Param('projectId') projectId: string,
        @Body() dto: ReorderBacklogScopeDto,
    ) {
        return this.backlog.reorderScope(tenant, projectId, dto);
    }

    @Patch(':projectId/tasks/order')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    reorderTasks(
        @Tenant() tenant: TenantContext,
        @Param('projectId') projectId: string,
        @Body() dto: ReorderBacklogTasksDto,
    ) {
        return this.backlog.reorderTasks(tenant, projectId, dto);
    }

    @Post(':projectId/scope/bulk')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    bulkScope(
        @Tenant() tenant: TenantContext,
        @Param('projectId') projectId: string,
        @Body() dto: BulkBacklogScopeDto,
    ) {
        return this.backlog.bulkScope(tenant, projectId, dto);
    }

    @Post(':projectId/tasks/bulk')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    bulkTasks(
        @Tenant() tenant: TenantContext,
        @Param('projectId') projectId: string,
        @Body() dto: BulkBacklogTasksDto,
    ) {
        return this.backlog.bulkTasks(tenant, projectId, dto);
    }
}
