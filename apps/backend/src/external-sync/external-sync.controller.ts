import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Put,
    Query,
    Request,
    StreamableFile,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'fs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { ExternalSyncMatchService } from './external-sync.match.service';
import { ExternalSyncService } from './external-sync.service';
import { ExternalSyncSnapshotService } from './snapshot/snapshot.service';
import { ApplyMatchDecisionsDto } from './external-sync.match.dto';
import {
    CreateSnapshotDto,
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
    constructor(
        private readonly externalSyncService: ExternalSyncService,
        private readonly matchService: ExternalSyncMatchService,
        private readonly snapshots: ExternalSyncSnapshotService,
    ) {}

    /**
     * The review workbook's contents: one row per provider record, with the
     * tenant record it most likely already is. Reads only.
     */
    @Get('match-candidates')
    getMatchCandidates(@Param('tenantId') tenantId: string, @Query('snapshotId') snapshotId: string) {
        if (!snapshotId?.trim()) throw new BadRequestException('snapshotId is required');
        return this.matchService.getCandidates(tenantId, snapshotId);
    }

    /** The reviewed workbook, applied as mappings a later run will honour. */
    @Post('match-decisions')
    applyMatchDecisions(@Param('tenantId') tenantId: string, @Body() dto: ApplyMatchDecisionsDto) {
        return this.matchService.applyDecisions(tenantId, dto);
    }

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

    @Post('snapshots')
    startExtract(
        @Param('tenantId') tenantId: string,
        @Body() dto: CreateSnapshotDto,
        @Request() req: any,
    ) {
        return this.snapshots.startExtract(tenantId, dto, req.user?.userId);
    }

    @Get('snapshots')
    listSnapshots(@Param('tenantId') tenantId: string, @Query('provider') provider?: string) {
        return this.snapshots.listSnapshots(tenantId, provider);
    }

    @Get('snapshots/:id')
    getSnapshot(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return this.snapshots.getSnapshot(tenantId, id);
    }

    @Post('snapshots/:id/cancel')
    cancelExtract(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return this.snapshots.cancelExtract(tenantId, id);
    }

    @Get('snapshots/:id/file')
    async downloadSnapshot(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const file = await this.snapshots.openFile(tenantId, id);
        return new StreamableFile(createReadStream(file.path), {
            type: 'application/gzip',
            disposition: `attachment; filename="${file.filename}"`,
        });
    }

    @Post('snapshots/upload')
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
    uploadSnapshot(
        @Param('tenantId') tenantId: string,
        @Query('provider') provider: string | undefined,
        @UploadedFile() file?: Express.Multer.File,
    ) {
        if (!file) throw new BadRequestException('No file uploaded');
        return this.snapshots.uploadSnapshot(tenantId, provider, file.buffer);
    }

    @Delete('snapshots/:id')
    deleteSnapshot(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        return this.snapshots.deleteSnapshot(tenantId, id);
    }
}
