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
import { ProjectTimeService } from './project-time.service';
import {
    CreateTimeEntryDto,
    ListTimeEntriesDto,
    TimeReportQueryDto,
    UpdateTimeEntryDto,
} from './project.dto';

@Controller('project-time')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ProjectTimeController {
    constructor(private readonly time: ProjectTimeService) {}

    @Get()
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    list(@Tenant() tenant: TenantContext, @Query() query: ListTimeEntriesDto) {
        return this.time.list(tenant.tenantId, resolveMe(query, tenant.userId));
    }

    /**
     * Declared before any parameterised GET so `/project-time/report` is never
     * read as an entry id.
     */
    @Get('report')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    report(@Tenant() tenant: TenantContext, @Query() query: TimeReportQueryDto) {
        return this.time.report(tenant.tenantId, resolveMe(query, tenant.userId));
    }

    /** Options for the "person" filter — everyone with hours in the range. */
    @Get('people')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    people(@Tenant() tenant: TenantContext, @Query() query: TimeReportQueryDto) {
        return this.time.people(tenant.tenantId, query);
    }

    @Post()
    @RequireStorePermission(StorePermission.LOG_PROJECT_TIME)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateTimeEntryDto) {
        return this.time.create(tenant.tenantId, tenant.userId, dto);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.LOG_PROJECT_TIME)
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateTimeEntryDto,
    ) {
        return this.time.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.LOG_PROJECT_TIME)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.time.remove(tenant.tenantId, tenant.userId, id);
    }
}

/**
 * `userId=me` saves the client a round trip to learn its own id, and keeps the
 * "my hours" filter working when the page is opened from a bookmark.
 */
function resolveMe<T extends { userId?: string }>(query: T, userId: string): T {
    return query.userId === 'me' ? { ...query, userId } : query;
}
