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

@Controller('price-lists')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class PriceListsController {
    constructor(private readonly service: PriceListsService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreatePriceListDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    @Get()
    findAll(@Tenant() tenant: TenantContext, @Query() query: PaginationDto) {
        return this.service.findAll(tenant.tenantId, query.page, query.limit);
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdatePriceListDto,
    ) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }

    @Get(':id/items')
    listItems(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query() query: PaginationDto,
        @Query('search') search?: string,
    ) {
        return this.service.listItems(tenant.tenantId, id, query.page, query.limit, search);
    }

    @Patch(':id/items/:productId')
    updateItem(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('productId') productId: string,
        @Body() dto: UpdatePriceListItemDto,
    ) {
        return this.service.updateItem(tenant.tenantId, id, productId, dto);
    }

    @Put(':id/items/bulk')
    bulkUpdateItems(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: BulkUpdatePriceListItemsDto,
    ) {
        return this.service.bulkUpdateItems(tenant.tenantId, id, dto);
    }

    @Post(':id/sync')
    syncProducts(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.syncProducts(tenant.tenantId, id);
    }
}