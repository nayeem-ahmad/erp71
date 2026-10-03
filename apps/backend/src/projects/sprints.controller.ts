import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Put,
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
import {
    AssignStoriesToSprintDto,
    AssignTasksToSprintDto,
    CompleteSprintDto,
    CreateSprintDto,
    UpdateSprintDto,
} from './project.dto';
import { SetBoardBackgroundImageDto } from './board.dto';

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

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_SPRINTS)
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateSprintDto,
    ) {
        return this.sprints.update(tenant.tenantId, id, dto);
    }

    /**
     * The uploaded half of the background; a colour goes through `PATCH :id`.
     * Split for the reason the board's is: megabytes of base64 that can fail on
     * their own must not take a rename down with them.
     *
     * MANAGE_SPRINTS, like every other change to the sprint: everyone who opens
     * it sees the background, so it is not a reader's preference.
     */
    @Put(':id/background/image')
    @RequireStorePermission(StorePermission.MANAGE_SPRINTS)
    setBackgroundImage(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: SetBoardBackgroundImageDto,
    ) {
        return this.sprints.setBackgroundImage(tenant.tenantId, id, dto);
    }

    /** Back to the plain sprint, whichever kind of background it had. */
    @Delete(':id/background')
    @RequireStorePermission(StorePermission.MANAGE_SPRINTS)
    clearBackground(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.sprints.clearBackground(tenant.tenantId, id);
    }

    @Post(':id/start')
    @RequireStorePermission(StorePermission.MANAGE_SPRINTS)
    start(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.sprints.start(tenant.tenantId, id);
    }

    @Post(':id/complete')
    @RequireStorePermission(StorePermission.MANAGE_SPRINTS)
    complete(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CompleteSprintDto,
    ) {
        return this.sprints.complete(tenant.tenantId, id, dto ?? {});
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

    /** Commits every open, unplanned task under the given stories. */
    @Post(':id/stories')
    @RequireStorePermission(StorePermission.MANAGE_SPRINTS)
    assignStories(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: AssignStoriesToSprintDto,
    ) {
        return this.sprints.assignStories(tenant, id, dto);
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
