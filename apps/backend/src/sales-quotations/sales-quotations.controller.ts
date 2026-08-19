import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, UseInterceptors, Delete } from '@nestjs/common';
import { PaginationDto } from '../common/pagination.dto';
import { SalesQuotationsService } from './sales-quotations.service';
import { CreateQuotationDto, UpdateQuotationDto, UpdateQuotationStatusDto } from './sales-quotations.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('sales-quotations')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class SalesQuotationsController {
    constructor(private readonly quotationsService: SalesQuotationsService) {}

    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateQuotationDto) {
        return this.quotationsService.create(tenant.tenantId, dto);
    }

    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: PaginationDto,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
    ) {
        return this.quotationsService.findAll(tenant.tenantId, query.page, query.limit, {
            createdFrom,
            createdTo,
        });
    }

    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.quotationsService.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    async update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateQuotationDto) {
        return this.quotationsService.update(tenant.tenantId, id, dto);
    }

    @Patch(':id/status')
    async updateStatus(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateQuotationStatusDto) {
        return this.quotationsService.updateStatus(tenant.tenantId, id, dto);
    }

    @Post(':id/revise')
    async revise(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.quotationsService.revise(tenant.tenantId, id);
    }

    @Post(':id/convert')
    async convertToOrder(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.quotationsService.convertToOrder(tenant.tenantId, tenant.userId, id);
    }

    @Post(':id/share')
    share(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.quotationsService.share(tenant.tenantId, tenant.userId, id);
    }

    // Declared before the general `:id` delete route below, or that route would
    // capture `/share` too and revoking a share would delete the quotation.
    @Delete(':id/share')
    revokeShare(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.quotationsService.revokeShare(tenant.tenantId, id);
    }

    @Delete(':id')
    async remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.quotationsService.remove(tenant.tenantId, id);
    }
}
