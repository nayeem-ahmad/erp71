import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { NoAudit } from '../audit/no-audit.decorator';
import { RecordHistoryService } from './record-history.service';

/**
 * Platform-admin reader for record history. Which types are recorded, and for
 * how long, is the `record_history` group under `/admin/platform-settings`.
 *
 * Deliberately platform-only for now: the snapshots carry cost prices and
 * every field of the record, and who inside a workspace may see that is a
 * per-tenant permission question nobody has answered yet.
 */
@ApiTags('record-history')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@NoAudit()
@Controller('admin/record-history')
export class AdminRecordHistoryController {
    constructor(private readonly history: RecordHistoryService) {}

    @Get()
    @ApiQuery({ name: 'tenant_id', required: false })
    @ApiQuery({ name: 'entity_type', required: false })
    @ApiQuery({ name: 'entity_id', required: false })
    @ApiQuery({ name: 'action', required: false })
    @ApiQuery({ name: 'user_id', required: false })
    @ApiQuery({ name: 'q', required: false, description: 'Label (invoice number, name) or exact record id' })
    @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD' })
    @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD' })
    @ApiQuery({ name: 'limit', required: false })
    @ApiQuery({ name: 'offset', required: false })
    list(
        @Query('tenant_id') tenantId?: string,
        @Query('entity_type') entityType?: string,
        @Query('entity_id') entityId?: string,
        @Query('action') action?: string,
        @Query('user_id') userId?: string,
        @Query('q') q?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        return this.history.query({
            tenantId: tenantId || undefined,
            entityType: entityType || undefined,
            entityId: entityId || undefined,
            action: action || undefined,
            userId: userId || undefined,
            q,
            from,
            to,
            limit: limit ? Number.parseInt(limit, 10) || undefined : undefined,
            offset: offset ? Number.parseInt(offset, 10) || undefined : undefined,
        });
    }

    @Get(':id')
    findOne(@Param('id', ParseUUIDPipe) id: string) {
        return this.history.findOne(id);
    }
}
