import { Controller, Get, Query, UseGuards, UseInterceptors, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { hasStorePermission } from '../auth/permission.util';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DatabaseService } from '../database/database.service';
import { AuditService } from './audit.service';
import { NoAudit } from './no-audit.decorator';

@ApiTags('audit-logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
@NoAudit()
@Controller('audit-logs')
export class AuditController {
    constructor(
        private readonly auditService: AuditService,
        private readonly db: DatabaseService,
    ) {}

    @Get()
    @ApiQuery({ name: 'entity', required: false })
    @ApiQuery({ name: 'entity_id', required: false })
    @ApiQuery({ name: 'action', required: false })
    @ApiQuery({ name: 'user_id', required: false })
    @ApiQuery({ name: 'from', required: false, description: 'ISO date string' })
    @ApiQuery({ name: 'to', required: false, description: 'ISO date string' })
    @ApiQuery({ name: 'limit', required: false })
    @ApiQuery({ name: 'offset', required: false })
    async list(
        @Tenant() tenant: TenantContext,
        @Query('entity') entity?: string,
        @Query('entity_id') entityId?: string,
        @Query('action') action?: string,
        @Query('user_id') userId?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string,
    ) {
        const canView =
            tenant.userRole === 'OWNER' ||
            (await hasStorePermission(this.db, tenant, StorePermission.MANAGE_USERS));
        if (!canView) {
            throw new ForbiddenException('You do not have permission to view audit logs');
        }

        const fromDate = from ? new Date(from) : undefined;
        const toDate = to ? new Date(to) : undefined;
        return this.auditService.query({ timezone: tenant.timezone,
            tenantId: tenant.tenantId,
            entity,
            entityId,
            action,
            userId,
            from,
            to,
            fromDate: fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : undefined,
            toDate: toDate && !Number.isNaN(toDate.getTime()) ? toDate : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            offset: offset ? parseInt(offset, 10) : undefined,
        });
    }
}
