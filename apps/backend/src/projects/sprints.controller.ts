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
import { SprintsService } from './sprints.service';
import { AssignTasksToSprintDto, CreateSprintDto, UpdateSprintDto } from './project.dto';

@Controller('sprints')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class SprintsController {
    constructor(private readonly sprints: SprintsService) {}

    @Get()
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    /** No projectId returns every sprint in the tenant; one filters by participation. */
    list(@Tenant() tenant: TenantContext, @Query('projectId') projectId?: string) {
        return this.sprints.list(tenant, projectId || undefined);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_SPRINTS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateSprintDto) {
        return this.sprints.create(tenant.tenantId, dto);
    }

    @Get(':id')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.sprints.findOne(tenant.tenantId, id);
    }

    @Get(':id/burndown')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    burndown(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.sprints.burndown(tenant.tenantId, id);
    }

    /**
     * Repairs gaps by replaying the remaining-hours log. Available because the
     * snapshots are a cache — without the log this endpoint could not exist.
     */
    @Post(':id/rebuild-snapshots')
    @RequireStorePermission(StorePermission.MANAGE_SPRINTS)
    rebuild(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query('overwrite') overwrite?: string,
    ) {
        return this.sprints.rebuildSnapshots(tenant.tenantId, id, overwrite === 'true');
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_SPRINTS)
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateSprintDto,
    ) {
        return this.sprints.update(tenant.tenantId, id, dto);
    }

    @Post(':id/start')
    @RequireStorePermission(StorePermission.MANAGE_SPRINTS)
    start(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.sprints.start(tenant.tenantId, id);
    }

    @Post(':id/complete')
    @RequireStorePermission(StorePermission.MANAGE_SPRINTS)
    complete(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.sprints.complete(tenant.tenantId, id);
    }

    @Post(':id/tasks')
    @RequireStorePermission(StorePermission.MANAGE_SPRINTS)
    assignTasks(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: AssignTasksToSprintDto,
    ) {
        return this.sprints.assignTasks(tenant, id, dto);
    }

    @Delete(':id/tasks')
    @RequireStorePermission(StorePermission.MANAGE_SPRINTS)
    removeTasks(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: AssignTasksToSprintDto,
    ) {
        return this.sprints.removeTasks(tenant, id, dto);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.MANAGE_SPRINTS)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.sprints.remove(tenant.tenantId, id);
    }
}
