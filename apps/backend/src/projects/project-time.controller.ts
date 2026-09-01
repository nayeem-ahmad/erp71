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
import { ImportRowsDto } from '../common/import.dto';
import { ProjectTimeService } from './project-time.service';
import { ProjectTimerService } from './project-timer.service';
import { ProjectSettingsService } from './project-settings.service';
import {
    CreateTimeEntryDto,
    ListTimeEntriesDto,
    StartTimerDto,
    StopTimerDto,
    TimeReportQueryDto,
    UpdateTimeEntryDto,
    UpdateTimerDto,
} from './project.dto';

@Controller('project-time')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ProjectTimeController {
    constructor(
        private readonly time: ProjectTimeService,
        private readonly timers: ProjectTimerService,
        private readonly settings: ProjectSettingsService,
    ) {}

    @Get()
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    list(@Tenant() tenant: TenantContext, @Query() query: ListTimeEntriesDto) {
        return this.time.list(tenant, resolveMe(query, tenant.userId));
    }

    /**
     * Declared before any parameterised GET so `/project-time/report` is never
     * read as an entry id.
     */
    @Get('report')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    report(@Tenant() tenant: TenantContext, @Query() query: TimeReportQueryDto) {
        return this.time.report(tenant, resolveMe(query, tenant.userId));
    }

    /** Options for the "person" filter — everyone with hours in the range. */
    @Get('people')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    people(@Tenant() tenant: TenantContext, @Query() query: TimeReportQueryDto) {
        return this.time.people(tenant, query);
    }

    /**
     * The tag vocabulary, read-only and beside the hours it classifies. The
     * write half lives on `/projects/time-tags` with the other settings, which
     * is also where the permission changes from reading to managing.
     */
    @Get('tags')
    @RequireStorePermission(StorePermission.VIEW_PROJECTS)
    tags(@Tenant() tenant: TenantContext) {
        return this.settings.listTimeTags(tenant.tenantId);
    }

    // ── The running clock ──────────────────────────────────────────────────
    //
    // All declared before `:id`, or `/project-time/timer` would be read as an
    // entry id — the same rule `report` and `people` are already subject to.
    // Every one of these is the caller's own timer: none takes a user id.

    @Get('timer')
    @RequireStorePermission(StorePermission.LOG_PROJECT_TIME)
    currentTimer(@Tenant() tenant: TenantContext) {
        return this.timers.current(tenant);
    }

    @Post('timer')
    @RequireStorePermission(StorePermission.LOG_PROJECT_TIME)
    startTimer(@Tenant() tenant: TenantContext, @Body() dto: StartTimerDto) {
        return this.timers.start(tenant, dto);
    }

    @Patch('timer')
    @RequireStorePermission(StorePermission.LOG_PROJECT_TIME)
    updateTimer(@Tenant() tenant: TenantContext, @Body() dto: UpdateTimerDto) {
        return this.timers.update(tenant, dto);
    }

    @Post('timer/stop')
    @RequireStorePermission(StorePermission.LOG_PROJECT_TIME)
    stopTimer(@Tenant() tenant: TenantContext, @Body() dto: StopTimerDto) {
        return this.timers.stop(tenant, dto);
    }

    /** Throws the running clock away without recording anything. */
    @Delete('timer')
    @RequireStorePermission(StorePermission.LOG_PROJECT_TIME)
    discardTimer(@Tenant() tenant: TenantContext) {
        return this.timers.discard(tenant);
    }

    @Post()
    @RequireStorePermission(StorePermission.LOG_PROJECT_TIME)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateTimeEntryDto) {
        return this.time.create(tenant, dto);
    }

    /**
     * Every imported row is logged under the caller's own name, which is why
     * this needs no more than the permission to log time.
     */
    @Post('import')
    @RequireStorePermission(StorePermission.LOG_PROJECT_TIME)
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.time.importRows(tenant, body.rows, body.mode);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.LOG_PROJECT_TIME)
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateTimeEntryDto,
    ) {
        return this.time.update(tenant, id, dto);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.LOG_PROJECT_TIME)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.time.remove(tenant, id);
    }
}

/**
 * `userId=me` saves the client a round trip to learn its own id, and keeps the
 * "my hours" filter working when the page is opened from a bookmark.
 */
function resolveMe<T extends { userId?: string }>(query: T, userId: string): T {
    return query.userId === 'me' ? { ...query, userId } : query;
}
