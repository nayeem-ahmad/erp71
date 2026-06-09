import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { AuditService } from './audit.service';

@ApiTags('audit-logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
@Controller('audit-logs')
export class AuditController {
    constructor(private readonly auditService: AuditService) {}

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
        return this.auditService.query({
            tenantId: tenant.tenantId,
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
