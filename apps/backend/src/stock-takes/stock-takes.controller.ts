import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { PaginationDto } from '../common/pagination.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CreateStockTakeSessionDto, UpdateStockTakeCountsDto, UpdateStockTakeStatusDto } from './stock-takes.dto';
import { StockTakesService } from './stock-takes.service';

@Controller('stock-takes')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class StockTakesController {
    constructor(private readonly service: StockTakesService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateStockTakeSessionDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    @Get()
    findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: PaginationDto,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
    ) {
        return this.service.findAll(tenant.tenantId, query.page, query.limit, { timezone: tenant.timezone,
            createdFrom,
            createdTo,
        });
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @Patch(':id/counts')
    updateCounts(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateStockTakeCountsDto) {
        return this.service.updateCounts(tenant.tenantId, id, dto);
    }

    @Patch(':id/status')
    updateStatus(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateStockTakeStatusDto) {
        return this.service.updateStatus(tenant.tenantId, id, dto);
    }

    @Post(':id/post')
    post(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.post(tenant.tenantId, id);
    }
}