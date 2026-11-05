import {
    Body,
    Controller,
    Delete,
    Get,
    NotFoundException,
    Param,
    Patch,
    Post,
    Put,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { BoardsService } from './boards.service';
import { BoardColumnsService } from './board-columns.service';
import {
    AddBoardTasksDto,
    CreateBoardCardDto,
    CreateBoardColumnDto,
    CreateBoardDto,
    MoveBoardCardDto,
    MoveBoardCardsDto,
    OrderBoardColumnCardsDto,
    RemoveBoardCardsDto,
    ReorderBoardColumnsDto,
    SetBoardBackgroundImageDto,
    SetBoardColumnStatusesDto,
    UpdateBoardColumnDto,
    UpdateBoardDto,
} from './board.dto';

/**
 * Two kinds of write live here, and they take different permissions.
 *
 * The board itself — creating, renaming, deleting it, its background — is
 * MANAGE_PROJECTS: it is shared furniture everyone who opens it sees.
 *
 * The cards on it are task work, so they take MANAGE_PROJECT_TASKS, the same
 * permission the task panel and task list take for the same changes: composing
 * a card creates a task, dropping one changes its status, sorting or pulling
 * one off a board only moves a task around. A Project User holds that and not
 * MANAGE_PROJECTS, and must be able to work a board without being made a
 * project manager. Every card route still narrows to the tasks and projects
 * the caller can see (see BoardsService), so this widens who may act, not what
 * they may act on.
 */
@Controller('projects/boards')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class BoardsController {
    constructor(
        private readonly boards: BoardsService,
        private readonly columns: BoardColumnsService,
    ) {}

    @Get()
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    list(@Tenant() tenant: TenantContext) {
        return this.boards.list(tenant);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateBoardDto) {
        return this.boards.create(tenant.tenantId, tenant.userId, dto);
    }

    /**
     * Declared before `@Get(':id')` deliberately: Nest matches in declaration
     * order, so an `:id` route first would read `/resolve/erp71` as a board
     * whose id is "resolve".
     */
    @Get('resolve/:slug')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    async resolveBoard(@Tenant() tenant: TenantContext, @Param('slug') slug: string) {
        const found = await this.boards.resolveSlug(tenant.tenantId, slug);
        if (!found) throw new NotFoundException('Board not found');
        return { id: found.boardId, currentKey: found.currentSlug, moved: found.moved };
    }

    @Get(':id')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.boards.findOne(tenant, id);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateBoardDto) {
        return this.boards.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.boards.remove(tenant.tenantId, id);
    }

    /**
     * The uploaded half of the background. A colour goes through `PATCH :id`
     * with the rest of the board's fields; an image cannot, because the payload
     * is megabytes of base64 and storing it has to be able to fail on its own —
     * a rename must not be refused because a CDN is down.
     *
     * MANAGE_PROJECTS, the same as renaming the board: the background is the
     * board's, seen by everyone who opens it, so it is not a view preference
     * that any reader may set.
     */
    @Put(':id/background/image')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    setBackgroundImage(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: SetBoardBackgroundImageDto,
    ) {
        return this.boards.setBackgroundImage(tenant.tenantId, id, dto);
    }

    /** Back to the plain board, whichever kind of background it had. */
    @Delete(':id/background')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    clearBackground(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.boards.clearBackground(tenant.tenantId, id);
    }

    @Post(':id/tasks')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    addTasks(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: AddBoardTasksDto,
    ) {
        return this.boards.addTasks(tenant, id, dto.taskIds);
    }

    /**
     * Composing into a column, not adding an existing task — hence the column in
     * the path and a title in the body rather than a list of task ids.
     *
     * MANAGE_PROJECT_TASKS, as `POST /projects/tasks` requires: the call
     * creates a task, and putting it on the board is card work, which takes the
     * same permission. It must never take less — that would make this route a
     * way to create tasks without the permission that governs creating them.
     */
    @Post(':id/columns/:columnId/cards')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    createCard(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('columnId') columnId: string,
        @Body() dto: CreateBoardCardDto,
    ) {
        return this.boards.createCard(tenant, id, columnId, dto);
    }

    @Delete(':id/tasks/:taskId')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    removeTask(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('taskId') taskId: string,
    ) {
        return this.boards.removeTask(tenant, id, taskId);
    }

    @Patch(':id/tasks/:taskId/move')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    moveCard(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('taskId') taskId: string,
        @Body() dto: MoveBoardCardDto,
    ) {
        return this.boards.moveCard(tenant, id, taskId, dto);
    }

    /**
     * Several cards into one column — the column menu's "move all cards to" and
     * the selection bar. MANAGE_PROJECT_TASKS, the same as the single-card drop
     * it repeats: doing a thing in bulk is not a different permission.
     */
    @Post(':id/cards/move')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    moveCards(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: MoveBoardCardsDto,
    ) {
        return this.boards.moveCards(tenant, id, dto);
    }

    @Post(':id/cards/remove')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    removeCards(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: RemoveBoardCardsDto,
    ) {
        return this.boards.removeCards(tenant, id, dto.taskIds);
    }

    /**
     * One column's card order, as "sort cards" leaves it. Ordering cards is
     * moving cards, so it takes MANAGE_PROJECT_TASKS rather than the settings
     * permission the column's own shape takes.
     */
    @Put(':id/columns/:columnId/cards/order')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_TASKS)
    orderColumnCards(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('columnId') columnId: string,
        @Body() dto: OrderBoardColumnCardsDto,
    ) {
        return this.boards.orderCards(tenant, id, columnId, dto.taskIds);
    }

    @Get(':id/columns')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    listColumns(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.columns.listColumns(tenant.tenantId, id);
    }

    @Post(':id/columns')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    createColumn(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CreateBoardColumnDto,
    ) {
        return this.columns.createColumn(tenant.tenantId, id, dto);
    }

    /**
     * Declared above `:id/columns/:columnId` so "order" is read as the literal
     * it is rather than as a column id — the two patterns are different HTTP
     * methods today, but the next PUT on a column would make that accidental.
     */
    @Put(':id/columns/order')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    reorderColumns(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: ReorderBoardColumnsDto,
    ) {
        return this.columns.reorderColumns(tenant.tenantId, id, dto.columnIds);
    }

    @Patch(':id/columns/:columnId')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    updateColumn(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('columnId') columnId: string,
        @Body() dto: UpdateBoardColumnDto,
    ) {
        return this.columns.updateColumn(tenant.tenantId, id, columnId, dto);
    }

    @Delete(':id/columns/:columnId')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    deleteColumn(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('columnId') columnId: string,
    ) {
        return this.columns.deleteColumn(tenant.tenantId, id, columnId);
    }

    @Put(':id/columns/:columnId/statuses')
    @RequireStorePermission(StorePermission.MANAGE_PROJECT_SETTINGS)
    setColumnStatuses(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('columnId') columnId: string,
        @Body() dto: SetBoardColumnStatusesDto,
    ) {
        return this.columns.setBindings(tenant.tenantId, id, columnId, dto.statusIds);
    }
}
