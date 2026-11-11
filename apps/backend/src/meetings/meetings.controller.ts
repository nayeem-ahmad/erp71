import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TrackHistory } from '../record-history/track-history.decorator';
import { MEETINGS_MANAGE, MEETINGS_READ } from '../auth/permission-sets';
import {
    CreateMeetingDto,
    EmailMinutesDto,
    ListMeetingActionsQueryDto,
    ListMeetingsQueryDto,
    UpdateMeetingActionDto,
    UpdateMeetingDto,
} from './meetings.dto';
import { MeetingsService } from './meetings.service';

@Controller('meetings')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class MeetingsController {
    constructor(private readonly meetings: MeetingsService) {}

    @Get()
    @RequireAnyStorePermission(...MEETINGS_READ)
    findAll(@Tenant() tenant: TenantContext, @Query() query: ListMeetingsQueryDto) {
        return this.meetings.findAll(tenant, query);
    }

    @Post()
    @RequireAnyStorePermission(...MEETINGS_MANAGE)
    @TrackHistory('MEETING', { action: 'CREATE' })
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateMeetingDto) {
        return this.meetings.create(tenant, dto);
    }

    @Get(':id')
    @RequireAnyStorePermission(...MEETINGS_READ)
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.meetings.findOne(tenant, id);
    }

    @Patch(':id')
    @RequireAnyStorePermission(...MEETINGS_MANAGE)
    @TrackHistory('MEETING', { action: 'UPDATE' })
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateMeetingDto) {
        return this.meetings.update(tenant, id, dto);
    }

    @Post(':id/finalize')
    @RequireAnyStorePermission(...MEETINGS_MANAGE)
    @TrackHistory('MEETING', { action: 'FINALIZE' })
    finalize(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.meetings.finalize(tenant, id);
    }

    @Post(':id/cancel')
    @RequireAnyStorePermission(...MEETINGS_MANAGE)
    @TrackHistory('MEETING', { action: 'CANCEL' })
    cancel(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.meetings.cancel(tenant, id);
    }

    @Post(':id/share')
    @RequireAnyStorePermission(...MEETINGS_MANAGE)
    share(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.meetings.share(tenant, id);
    }

    @Delete(':id/share')
    @RequireAnyStorePermission(...MEETINGS_MANAGE)
    revokeShare(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.meetings.revokeShare(tenant, id);
    }

    @Post(':id/email')
    @RequireAnyStorePermission(...MEETINGS_MANAGE)
    emailMinutes(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: EmailMinutesDto) {
        return this.meetings.emailMinutes(tenant, id, dto);
    }
}

@Controller('meeting-actions')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class MeetingActionsController {
    constructor(private readonly meetings: MeetingsService) {}

    @Get()
    @RequireAnyStorePermission(...MEETINGS_READ)
    list(@Tenant() tenant: TenantContext, @Query() query: ListMeetingActionsQueryDto) {
        return this.meetings.listActions(tenant, query);
    }

    @Get('overdue-count')
    @RequireAnyStorePermission(...MEETINGS_READ)
    overdueCount(@Tenant() tenant: TenantContext) {
        return this.meetings.overdueCount(tenant);
    }

    @Patch(':id')
    @RequireAnyStorePermission(...MEETINGS_READ)
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateMeetingActionDto,
    ) {
        return this.meetings.updateAction(tenant, id, dto);
    }
}
