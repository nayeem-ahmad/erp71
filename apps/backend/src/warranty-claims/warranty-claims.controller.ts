import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { PaginationDto } from '../common/pagination.dto';
import { WarrantyClaimsService } from './warranty-claims.service';
import { CreateWarrantyClaimDto, UpdateWarrantyClaimStatusDto } from './warranty-claim.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('warranty-claims')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class WarrantyClaimsController {
    constructor(private readonly warrantyClaimsService: WarrantyClaimsService) {}

    @Get('lookup')
    async lookup(@Tenant() tenant: TenantContext, @Query('serialNumber') serialNumber: string) {
        return this.warrantyClaimsService.lookup(tenant.tenantId, serialNumber);
    }

    @Post()
    async create(@Tenant() tenant: TenantContext, @Body() dto: CreateWarrantyClaimDto) {
        return this.warrantyClaimsService.create(tenant.tenantId, dto);
    }

    @Get()
    async findAll(
        @Tenant() tenant: TenantContext,
        @Query() query: PaginationDto,
        @Query('createdFrom') createdFrom?: string,
        @Query('createdTo') createdTo?: string,
    ) {
        return this.warrantyClaimsService.findAll(tenant.tenantId, query.page, query.limit, { timezone: tenant.timezone,
            createdFrom,
            createdTo,
        });
    }

    @Get(':id')
    async findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.warrantyClaimsService.findOne(tenant.tenantId, id);
    }

    @Patch(':id/status')
    async updateStatus(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateWarrantyClaimStatusDto,
    ) {
        return this.warrantyClaimsService.updateStatus(tenant.tenantId, id, dto);
    }
}
