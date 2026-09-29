import {
    Controller,
    Post,
    Get,
    Patch,
    Delete,
    Put,
    Body,
    Param,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { PaginationDto } from '../common/pagination.dto';
import { PriceListsService } from './price-lists.service';
import {
    BulkUpdatePriceListItemsDto,
    CreatePriceListDto,
    UpdatePriceListDto,
    UpdatePriceListItemDto,
} from './price-lists.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ImportRowsDto } from '../common/import.dto';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { PRICE_LIST_READ, PRODUCT_WRITE } from '../auth/permission-sets';
@Controller('price-lists')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class PriceListsController {
    constructor(private readonly service: PriceListsService) {}

    @RequireAnyStorePermission(...PRODUCT_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreatePriceListDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...PRODUCT_WRITE)
    @Post('import')
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.service.importRows(tenant.tenantId, body.rows, body.mode);
    }

    @RequireAnyStorePermission(...PRICE_LIST_READ)
    @Get()
    findAll(@Tenant() tenant: TenantContext, @Query() query: PaginationDto) {
        return this.service.findAll(tenant.tenantId, query.page, query.limit);
    }

    @RequireAnyStorePermission(...PRICE_LIST_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...PRODUCT_WRITE)
    @Patch(':id')
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdatePriceListDto,
    ) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...PRODUCT_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...PRICE_LIST_READ)
    @Get(':id/items')
    listItems(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query() query: PaginationDto,
        @Query('search') search?: string,
    ) {
        return this.service.listItems(tenant.tenantId, id, query.page, query.limit, search);
    }

    @RequireAnyStorePermission(...PRODUCT_WRITE)
    @Patch(':id/items/:productId')
    updateItem(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('productId') productId: string,
        @Body() dto: UpdatePriceListItemDto,
    ) {
        return this.service.updateItem(tenant.tenantId, id, productId, dto);
    }

    @RequireAnyStorePermission(...PRODUCT_WRITE)
    @Put(':id/items/bulk')
    bulkUpdateItems(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: BulkUpdatePriceListItemsDto,
    ) {
        return this.service.bulkUpdateItems(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...PRODUCT_WRITE)
    @Post(':id/sync')
    syncProducts(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.syncProducts(tenant.tenantId, id);
    }
}