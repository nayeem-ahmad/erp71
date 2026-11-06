import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Param,
    Body,
    Query,
    UseGuards,
    UseInterceptors,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DeliveryService } from './delivery.service';
import { CreateDeliveryDto, DeliveryListQueryDto, UpdateDeliveryDto } from './delivery.dto';
import { readIdListQuery } from '../common/number-condition.util';
import type { DeliveryListFilters } from './delivery.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { DELIVERY_WRITE, SALES_READ } from '../auth/permission-sets';
/** Reads the list's filter keys off the query. */
export function readDeliveryListFilters(query: DeliveryListQueryDto, timezone: string): DeliveryListFilters {
    return {
        search: query.search?.trim() || undefined,
        statuses: readIdListQuery(query.status) ?? [],
        statusExclude: query.statusExclude === 'true' || query.statusExclude === '1',
        drivers: readIdListQuery(query.driver),
        scheduledFrom: query.dateFrom || undefined,
        scheduledTo: query.dateTo || undefined,
        createdFrom: query.createdFrom || undefined,
        createdTo: query.createdTo || undefined,
        timezone,
    };
}

@Controller('delivery')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class DeliveryController {
    constructor(private readonly deliveryService: DeliveryService) {}

    @RequireAnyStorePermission(...SALES_READ)
    @Get()
    listDeliveries(@Tenant() tenant: TenantContext, @Query() query: DeliveryListQueryDto) {
        return this.deliveryService.listDeliveries(tenant.tenantId, query.page, query.limit, {
            ...readDeliveryListFilters(query, tenant.timezone),
            sortBy: query.sortBy,
            sortDir: query.sortDir,
        });
    }

    /**
     * The stats strip above the delivery list, over the same filters as
     * `GET /delivery`. Declared before `:id`.
     */
    @RequireAnyStorePermission(...SALES_READ)
    @Get('summary')
    summary(@Tenant() tenant: TenantContext, @Query() query: DeliveryListQueryDto) {
        return this.deliveryService.summary(tenant.tenantId, readDeliveryListFilters(query, tenant.timezone));
    }

    /** The driver names used so far, for the list's Driver chip. Declared before `:id`. */
    @RequireAnyStorePermission(...SALES_READ)
    @Get('drivers')
    listDrivers(@Tenant() tenant: TenantContext) {
        return this.deliveryService.listDrivers(tenant.tenantId);
    }

    @RequireAnyStorePermission(...SALES_READ)
    @Get(':id')
    getDelivery(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.deliveryService.getDelivery(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...DELIVERY_WRITE)
    @Post()
    @HttpCode(HttpStatus.CREATED)
    createDelivery(@Tenant() tenant: TenantContext, @Body() dto: CreateDeliveryDto) {
        return this.deliveryService.createDelivery(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...DELIVERY_WRITE)
    @Patch(':id')
    updateDelivery(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateDeliveryDto,
    ) {
        return this.deliveryService.updateDelivery(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...DELIVERY_WRITE)
    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    cancelDelivery(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.deliveryService.cancelDelivery(tenant.tenantId, id);
    }
}
