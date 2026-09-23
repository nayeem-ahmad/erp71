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
import { ProjectStoriesService } from './project-stories.service';
import {
    CreateUserStoryDto,
    ListUserStoriesDto,
    UpdateUserStoryDto,
} from './project.dto';

/**
 * Its own controller rather than more routes on `ProjectsController`, which is
 * already long enough that its literal paths have to be declared above `:id` to
 * survive. Reading a story needs no more than reading the project it belongs to;
 * writing one is MANAGE_PROJECTS, the permission milestones already take —
 * a story is scope the project is committing to, not a card on a board.
 */
@Controller('project-stories')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ProjectStoriesController {
    constructor(private readonly stories: ProjectStoriesService) {}

    @Get()
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    list(@Tenant() tenant: TenantContext, @Query() query: ListUserStoriesDto) {
        return this.stories.list(tenant, query);
    }

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateUserStoryDto) {
        return this.stories.create(tenant, dto);
    }

    /** Declared before `:id` so `/project-stories/import` is never read as a story id. */
    @Post('import')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.stories.importRows(tenant, body.rows, body.mode);
    }

    @Get(':id')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.stories.findOne(tenant, id);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateUserStoryDto,
    ) {
        return this.stories.update(tenant, id, dto);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.MANAGE_PROJECTS)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.stories.remove(tenant, id);
    }
}
