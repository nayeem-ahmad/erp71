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
import { ProjectTasksService } from './project-tasks.service';
import {
    CreateChecklistItemDto,
    CreateTaskDto,
    ListTasksDto,
    MoveTaskDto,
    UpdateChecklistItemDto,
    UpdateTaskDto,
} from './project.dto';

@Controller('project-tasks')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ProjectTasksController {
    constructor(private readonly tasks: ProjectTasksService) {}

    @Get()
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    list(@Tenant() tenant: TenantContext, @Query() query: ListTasksDto) {
        return this.tasks.list(tenant.tenantId, query);
    }

    /** Both board modes come from here — scrum passes a sprintId, kanban does not. */
    @Get('board/:projectId')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    board(
        @Tenant() tenant: TenantContext,
        @Param('projectId') projectId: string,
        @Query('sprintId') sprintId?: string,
    ) {
        return this.tasks.board(tenant.tenantId, projectId, sprintId || undefined);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateTaskDto) {
        return this.tasks.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get(':id')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.tasks.findOne(tenant.tenantId, id);
    }

    /** The audit view: why the burndown moved, who moved it, and when. */
    @Get(':id/remaining-history')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    remainingHistory(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.tasks.remainingHistory(tenant.tenantId, id);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateTaskDto,
    ) {
        return this.tasks.update(tenant.tenantId, tenant.userId, id, dto);
    }

    @Patch(':id/move')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    move(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: MoveTaskDto) {
        return this.tasks.move(tenant.tenantId, tenant.userId, id, dto);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.tasks.remove(tenant.tenantId, id);
    }

    @Post(':id/checklist')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    addChecklistItem(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CreateChecklistItemDto,
    ) {
        return this.tasks.addChecklistItem(tenant.tenantId, id, dto);
    }

    @Patch('checklist/:itemId')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    updateChecklistItem(
        @Tenant() tenant: TenantContext,
        @Param('itemId') itemId: string,
        @Body() dto: UpdateChecklistItemDto,
    ) {
        return this.tasks.updateChecklistItem(tenant.tenantId, itemId, dto);
    }

    @Delete('checklist/:itemId')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    removeChecklistItem(@Tenant() tenant: TenantContext, @Param('itemId') itemId: string) {
        return this.tasks.removeChecklistItem(tenant.tenantId, itemId);
    }
}
