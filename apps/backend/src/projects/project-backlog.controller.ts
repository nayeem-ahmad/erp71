import { Controller, Get, Param, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ProjectBacklogService } from './project-backlog.service';

/**
 * Its own prefix rather than `projects/:id/backlog`, for the reason
 * `ProjectStoriesController` gives: `ProjectsController`'s literal routes
 * already have to be ordered around its `:id`.
 */
@Controller('project-backlog')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ProjectBacklogController {
    constructor(private readonly backlog: ProjectBacklogService) {}

    @Get(':projectId')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    get(@Tenant() tenant: TenantContext, @Param('projectId') projectId: string) {
        return this.backlog.get(tenant, projectId);
    }
}
