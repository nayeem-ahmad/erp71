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
import { ImportRowsDto } from '../common/import.dto';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ProjectEpicsService } from './project-epics.service';
import {
    CreateEpicDto,
    ListEpicsDto,
    UpdateEpicDto,
} from './project.dto';

/**
 * Epics sit one level above stories and take the same permissions: reading one
 * needs no more than reading its project; writing one is MANAGE_PROJECTS.
 */
@Controller('project-epics')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ProjectEpicsController {
    constructor(private readonly epics: ProjectEpicsService) {}

    @Get()
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    list(@Tenant() tenant: TenantContext, @Query() query: ListEpicsDto) {
        return this.epics.list(tenant, query);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateEpicDto) {
        return this.epics.create(tenant, dto);
    }

    /** Declared before `:id` so `/project-epics/import` is never read as an epic id. */
    @Post('import')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.epics.importRows(tenant, body.rows, body.mode);
    }

    @Get(':id')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.epics.findOne(tenant, id);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateEpicDto,
    ) {
        return this.epics.update(tenant, id, dto);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.epics.remove(tenant, id);
    }
}
