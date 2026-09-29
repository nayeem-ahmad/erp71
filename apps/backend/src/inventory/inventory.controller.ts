import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import {
    CreateWarehouseDto,
    CreateInventoryReasonDto,
    ListInventoryReasonsQueryDto,
    ListStockLedgerQueryDto,
    UpdateInventoryReasonDto,
    UpdateInventorySettingsDto,
    UpdateWarehouseDto,
} from './inventory.dto';
import { ImportRowsDto } from '../common/import.dto';
import { InventoryService } from './inventory.service';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { CATALOG_READ, INVENTORY_REPORT_READ, INVENTORY_WRITE } from '../auth/permission-sets';
@Controller('inventory')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class InventoryController {
    constructor(private readonly service: InventoryService) {}

    @RequireAnyStorePermission(...CATALOG_READ)
    @Get('warehouses')
    getWarehouses(@Tenant() tenant: TenantContext) {
        return this.service.getWarehouses(tenant.tenantId);
    }

    @RequireAnyStorePermission(...INVENTORY_WRITE)
    @Post('warehouses')
    createWarehouse(@Tenant() tenant: TenantContext, @Body() dto: CreateWarehouseDto) {
        return this.service.createWarehouse(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...INVENTORY_WRITE)
    @Post('warehouses/import')
    importWarehouses(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.service.importWarehouses(tenant.tenantId, body.rows, body.mode);
    }

    @RequireAnyStorePermission(...INVENTORY_WRITE)
    @Patch('warehouses/:id')
    updateWarehouse(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateWarehouseDto) {
        return this.service.updateWarehouse(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...CATALOG_READ)
    @Get('settings')
    getSettings(@Tenant() tenant: TenantContext) {
        return this.service.getSettings(tenant.tenantId);
    }

    @RequireAnyStorePermission(...INVENTORY_WRITE)
    @Patch('settings')
    updateSettings(@Tenant() tenant: TenantContext, @Body() dto: UpdateInventorySettingsDto) {
        return this.service.updateSettings(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...CATALOG_READ)
    @Get('reasons')
    listReasons(@Tenant() tenant: TenantContext, @Query() query: ListInventoryReasonsQueryDto) {
        return this.service.listReasons(tenant.tenantId, query);
    }

    @RequireAnyStorePermission(...INVENTORY_WRITE)
    @Post('reasons')
    createReason(@Tenant() tenant: TenantContext, @Body() dto: CreateInventoryReasonDto) {
        return this.service.createReason(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...INVENTORY_WRITE)
    @Patch('reasons/:id')
    updateReason(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateInventoryReasonDto) {
        return this.service.updateReason(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...INVENTORY_REPORT_READ)
    @Get('ledger')
    getLedger(@Tenant() tenant: TenantContext, @Query() query: ListStockLedgerQueryDto) {
        return this.service.getLedger(tenant.tenantId, query);
    }
}