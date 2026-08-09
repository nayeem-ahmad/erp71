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
import { ProjectActivityService } from './project-activity.service';
import { ProjectCommentsService } from './project-comments.service';
import { ProjectAttachmentsService } from './project-attachments.service';
import {
    CreateAttachmentDto,
    CreateChecklistItemDto,
    CreateCommentDto,
    CreateTaskDto,
    ListTasksDto,
    MoveTaskDto,
    ReorderChecklistDto,
    UpdateChecklistItemDto,
    UpdateCommentDto,
    UpdateTaskDto,
} from './project.dto';

@Controller('project-tasks')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ProjectTasksController {
    constructor(
        private readonly tasks: ProjectTasksService,
        private readonly comments: ProjectCommentsService,
        private readonly activity: ProjectActivityService,
        private readonly attachments: ProjectAttachmentsService,
    ) {}

    @Get()
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    list(@Tenant() tenant: TenantContext, @Query() query: ListTasksDto) {
        return this.tasks.list(tenant.tenantId, query);
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

    // Comments, watching and the feed are gated on VIEW_PROJECTS rather than
    // MANAGE_PROJECT_TASKS: if you can see the board you can discuss it and
    // subscribe to it. Editing stays restricted to your own comment, which is
    // enforced in the service and cannot be granted away by a permission.
    @Get(':id/comments')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    listComments(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.comments.list(tenant.tenantId, id);
    }

    @Post(':id/comments')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    addComment(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CreateCommentDto,
    ) {
        return this.comments.create(tenant.tenantId, tenant.userId, id, dto);
    }

    @Patch('comments/:commentId')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    updateComment(
        @Tenant() tenant: TenantContext,
        @Param('commentId') commentId: string,
        @Body() dto: UpdateCommentDto,
    ) {
        return this.comments.update(tenant.tenantId, tenant.userId, commentId, dto);
    }

    @Delete('comments/:commentId')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    removeComment(@Tenant() tenant: TenantContext, @Param('commentId') commentId: string) {
        return this.comments.remove(tenant.tenantId, tenant.userId, commentId);
    }

    @Get(':id/attachments')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    listAttachments(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.attachments.list(tenant.tenantId, id);
    }

    @Post(':id/attachments')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    addAttachment(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CreateAttachmentDto,
    ) {
        return this.attachments.create(tenant.tenantId, tenant.userId, id, dto);
    }

    @Delete('attachments/:attachmentId')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    removeAttachment(
        @Tenant() tenant: TenantContext,
        @Param('attachmentId') attachmentId: string,
    ) {
        return this.attachments.remove(tenant.tenantId, attachmentId);
    }

    @Get(':id/activity')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    listActivity(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.activity.list(tenant.tenantId, id);
    }

    @Get(':id/watchers')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    listWatchers(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.activity.listWatchers(tenant.tenantId, id);
    }

    @Post(':id/watch')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    async watch(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        await this.tasks.assertTask(tenant.tenantId, id);
        return this.activity.watch(tenant.tenantId, id, tenant.userId);
    }

    @Delete(':id/watch')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    unwatch(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.activity.unwatch(tenant.tenantId, id, tenant.userId);
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

    @Patch(':id/checklist/reorder')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    reorderChecklist(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: ReorderChecklistDto,
    ) {
        return this.tasks.reorderChecklist(tenant.tenantId, id, dto.itemIds);
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
