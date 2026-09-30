import { Controller, Get, NotFoundException, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequiresPlan } from '../auth/subscription-access.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DatabaseService } from '../database/database.service';
import { zonedDateString } from '../common/tenant-time.util';
import { GetDailyReportDto } from './daily-report.dto';
import { DailyReportService } from './daily-report.service';

@Controller('daily-report')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@UseInterceptors(TenantInterceptor)
@RequiresPlan('BASIC')
export class DailyReportController {
    constructor(
        private readonly service: DailyReportService,
        private readonly db: DatabaseService,
    ) {}

    @Get()
    @RequireStorePermission(StorePermission.VIEW_FINANCIAL_REPORTS)
    async get(@Tenant() tenant: TenantContext, @Query() query: GetDailyReportDto) {
        const storeId = query.storeId || tenant.storeId;
        if (!storeId) {
            throw new NotFoundException('Store not found');
        }

        const store = await this.db.store.findFirst({
            where: { id: storeId, tenant_id: tenant.tenantId },
            select: { id: true, name: true },
        });
        if (!store) {
            throw new NotFoundException('Store not found');
        }

        const tenantRow = await this.db.tenant.findUnique({
            where: { id: tenant.tenantId },
            select: { name: true },
        });

        return this.service.getReport({
            tenantId: tenant.tenantId,
            storeId: store.id,
            tenantName: tenantRow?.name ?? '',
            storeName: store.name,
            date: query.date ?? zonedDateString(new Date(), tenant.timezone),
            timezone: tenant.timezone,
            locale: query.locale ?? 'en',
        });
    }
}
