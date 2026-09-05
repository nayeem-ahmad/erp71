import { Body, Controller, Delete, Get, Param, Post, Put, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { ExternalSyncService } from './external-sync.service';
import {
    ListExternalSyncRunsQueryDto,
    RunExternalSyncDto,
    TestExternalSyncConnectionDto,
    UpsertExternalSyncConnectionDto,
} from './external-sync.dto';

/**
 * Platform-admin only. Lives under the admin tenant namespace because an
 * external-ERP import is something we operate on a tenant's behalf, not a
 * feature the tenant's own users can reach.
 */
@Controller('admin/tenants/:tenantId/external-sync')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class ExternalSyncController {
    constructor(private readonly externalSyncService: ExternalSyncService) {}

    /** The external ERPs a connection can be created against. */
    @Get('providers')
    listProviders() {
        return this.externalSyncService.listProviders();
    }

    @Get()
    getConnection(@Param('tenantId') tenantId: string, @Query('provider') provider?: string) {
        return this.externalSyncService.getConnection(tenantId, provider);
    }

    @Put()
    upsertConnection(
        @Param('tenantId') tenantId: string,
        @Body() dto: UpsertExternalSyncConnectionDto,
        @Request() req: any,
    ) {
        return this.externalSyncService.upsertConnection(tenantId, dto, req.user?.userId);
    }

    @Delete()
    deleteConnection(@Param('tenantId') tenantId: string, @Query('provider') provider?: string) {
        return this.externalSyncService.deleteConnection(tenantId, provider);
    }

    @Post('test')
    testConnection(@Param('tenantId') tenantId: string, @Body() dto: TestExternalSyncConnectionDto) {
        return this.externalSyncService.testConnection(tenantId, dto);
    }

    @Post('runs')
    startRun(@Param('tenantId') tenantId: string, @Body() dto: RunExternalSyncDto, @Request() req: any) {
        return this.externalSyncService.startRun(tenantId, dto, 'MANUAL', req.user?.userId);
    }

    @Get('runs')
    listRuns(@Param('tenantId') tenantId: string, @Query() query: ListExternalSyncRunsQueryDto) {
        return this.externalSyncService.listRuns(tenantId, query);
    }

    /** Asks a running import to stop; it halts at the next chunk boundary. */
    @Post('runs/:runId/cancel')
    cancelRun(@Param('tenantId') tenantId: string, @Param('runId') runId: string) {
        return this.externalSyncService.cancelRun(tenantId, runId);
    }
}
