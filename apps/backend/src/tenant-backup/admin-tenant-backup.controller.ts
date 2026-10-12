import {
    BadRequestException,
    Body,
    ConflictException,
    Controller,
    Get,
    NotFoundException,
    Param,
    Post,
    Request,
    StreamableFile,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import { TenantBackupService } from './tenant-backup.service';

/** A year of a busy shop compresses to a few MB; this is headroom, not a target. */
const MAX_BACKUP_UPLOAD_BYTES = 200 * 1024 * 1024;

export class RestoreTenantBackupDto {
    /** The workspace's name, typed by the admin — the same guard as the Danger Zone's other actions. */
    @IsString() confirm!: string;
    @IsOptional() @IsString() reason?: string;
}

/** `Acme Traders Ltd.` → `acme-traders-ltd`, for the download's file name. */
function fileSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tenant';
}

@Controller('admin/tenants/:tenantId')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AdminTenantBackupController {
    constructor(
        private readonly backups: TenantBackupService,
        private readonly db: DatabaseService,
        private readonly audit: AuditService,
    ) {}

    /** Download the whole workspace as one gzipped JSON file. */
    @Get('backup')
    async download(@Param('tenantId') tenantId: string, @Request() req: any) {
        const tenant = await this.findTenant(tenantId);
        const { file, gzip, rows } = await this.backups.createBackup(tenant.id, req.user.email ?? null);

        await this.audit.log('tenant.backup.download', 'Tenant', { userId: req.user.userId, tenantId }, tenantId, {
            tenant_name: tenant.name,
            tables: Object.keys(file.tables).length,
            rows,
            bytes: gzip.length,
        });

        const stamp = file.created_at.replace(/[:.]/g, '-').slice(0, 19);
        return new StreamableFile(gzip, {
            type: 'application/gzip',
            disposition: `attachment; filename="erp71-backup-${fileSlug(tenant.name)}-${stamp}.json.gz"`,
            length: gzip.length,
        });
    }

    /**
     * Replace the workspace's data with an uploaded backup of the same
     * workspace. Destructive: everything entered since the backup is gone.
     */
    @Post('restore')
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BACKUP_UPLOAD_BYTES } }))
    async restore(
        @Param('tenantId') tenantId: string,
        @Body() dto: RestoreTenantBackupDto,
        @Request() req: any,
        @UploadedFile() file?: Express.Multer.File,
    ) {
        const tenant = await this.findTenant(tenantId);
        if (!file) throw new BadRequestException('No backup file uploaded.');
        if (dto.confirm.trim() !== tenant.name.trim()) {
            throw new BadRequestException('Type the workspace name exactly to confirm the restore.');
        }

        // A running load would go on inserting into the workspace mid-restore.
        const loading = await this.db.demoDataBatch.findFirst({
            where: { tenant_id: tenantId, status: { in: ['RUNNING', 'PENDING'] } },
            select: { id: true },
        });
        if (loading) {
            throw new ConflictException('A demo-data load is running for this tenant. Wait for it to finish, then restore.');
        }

        const backup = this.backups.parseBackup(file.buffer);
        const summary = await this.backups.restoreBackup(tenant.id, backup);

        await this.audit.log('tenant.backup.restore', 'Tenant', { userId: req.user.userId, tenantId }, tenantId, {
            tenant_name: tenant.name,
            backup_created_at: backup.created_at,
            backup_created_by: backup.created_by,
            reason: dto.reason ?? null,
            ...summary,
        });

        return { backup_created_at: backup.created_at, ...summary };
    }

    /** The same tenants the rest of the admin console acts on: live, and not the platform's own workspace. */
    private async findTenant(tenantId: string) {
        const tenant = await this.db.tenant.findFirst({
            where: { id: tenantId, deleted_at: null, platform_workspace_key: null },
            select: { id: true, name: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');
        return tenant;
    }
}
