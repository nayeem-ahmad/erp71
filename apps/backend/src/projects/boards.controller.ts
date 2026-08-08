import {
    Body,
    Controller,
    Delete,
    Get,
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
    CreateBoardColumnDto,
    CreateBoardDto,
    MoveBoardCardDto,
    SetBoardColumnStatusesDto,
    UpdateBoardColumnDto,
    UpdateBoardDto,
} from './board.dto';

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
        return this.boards.list(tenant.tenantId);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateBoardDto) {
        return this.boards.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get(':id')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.boards.findOne(tenant.tenantId, id);
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

    @Post(':id/tasks')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    addTasks(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: AddBoardTasksDto,
    ) {
        return this.boards.addTasks(tenant.tenantId, tenant.userId, id, dto.taskIds);
    }

    @Delete(':id/tasks/:taskId')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    removeTask(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('taskId') taskId: string,
    ) {
        return this.boards.removeTask(tenant.tenantId, id, taskId);
    }

    @Patch(':id/tasks/:taskId/move')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    moveCard(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('taskId') taskId: string,
        @Body() dto: MoveBoardCardDto,
    ) {
        return this.boards.moveCard(tenant.tenantId, tenant.userId, id, taskId, dto);
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
