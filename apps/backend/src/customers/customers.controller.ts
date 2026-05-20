import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { SegmentsService } from './segments.service';
import { CreateCustomerDto, UpdateCustomerDto } from './customer.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('customers')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class CustomersController {
    constructor(
        private readonly customersService: CustomersService,
        private readonly segmentsService: SegmentsService,
    ) {}

    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateCustomerDto) {
        return this.customersService.create(tenant.tenantId, dto);
    }

    @Get('segment-stats')
    async getSegmentStats(@Tenant() tenant: TenantContext) {
        return this.customersService.getSegmentStats(tenant.tenantId);
    }

    @Post('run-segmentation')
    async runSegmentation(@Tenant() tenant: TenantContext) {
        return this.segmentsService.runForTenant(tenant.tenantId);
    }

    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('search') search?: string,
    ) {
        return this.customersService.findAll(tenant.tenantId, {
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            search,
        });
    }

    @Post('segments/evaluate')
    async evaluateSegments(@Tenant() tenant: TenantContext) {
        return this.segmentsService.evaluateForTenant(tenant.tenantId);
    }

    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.customersService.findOne(tenant.tenantId, id);
    }

    @Get(':id/history')
    async getHistory(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        return this.customersService.getPurchaseHistory(tenant.tenantId, id, {
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
            from,
            to,
        });
    }

    @Patch(':id')
    async update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateCustomerDto) {
        return this.customersService.update(tenant.tenantId, id, dto);
    }
}
