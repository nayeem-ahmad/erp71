import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { AuditService } from './audit.service';
import { NoAudit } from './no-audit.decorator';
import { DEFAULT_TENANT_TIMEZONE } from '../common/tenant-time.util';

/**
 * The platform-side reader for the audit trail.
 *
 * `GET /audit-logs` filters strictly on `tenant_id`, so a row written by a
 * platform admin — which has none — is invisible there no matter who asks.
 * Writing those rows without somewhere to read them would only move the gap,
 * so this is the other half of that change.
 *
 * `scope=platform` (the default) is the interesting view: what staff did to the
 * platform. `scope=tenant` with a `tenant_id` reads one workspace's trail for
 * support, and `scope=all` reads everything.
 */
@ApiTags('audit-logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@NoAudit()
@Controller('admin/audit-logs')
export class AdminAuditController {
    constructor(private readonly auditService: AuditService) {}

    @Get()
    @ApiQuery({ name: 'scope', required: false, description: 'platform | tenant | all' })
    @ApiQuery({ name: 'tenant_id', required: false })
    @ApiQuery({ name: 'entity', required: false })
    @ApiQuery({ name: 'entity_id', required: false })
    @ApiQuery({ name: 'action', required: false })
    @ApiQuery({ name: 'user_id', required: false })
    @ApiQuery({ name: 'from', required: false, description: 'ISO date string' })
    @ApiQuery({ name: 'to', required: false, description: 'ISO date string' })
    @ApiQuery({ name: 'limit', required: false })
    @ApiQuery({ name: 'offset', required: false })
    async list(
        @Query('scope') scope = 'platform',
        @Query('tenant_id') tenantId?: string,
        @Query('entity') entity?: string,
        @Query('entity_id') entityId?: string,
        @Query('action') action?: string,
        @Query('user_id') userId?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        return this.auditService.query({
            // Platform scope spans every tenant, so no single workspace's
            // calendar applies. The platform's own zone is the honest choice;
            // this endpoint filters on `fromDate`/`toDate` instants anyway.
            timezone: DEFAULT_TENANT_TIMEZONE,
            platformOnly: scope !== 'tenant' && scope !== 'all',
            tenantId: scope === 'tenant' ? tenantId : undefined,
            entity,
            entityId,
            action,
            userId,
            fromDate: from ? new Date(from) : undefined,
            toDate: to ? new Date(to) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            offset: offset ? parseInt(offset, 10) : undefined,
        });
    }
}
