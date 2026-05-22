import { Controller, Get, Post, Delete, Patch, Body, Param, UseGuards, UseInterceptors } from '@nestjs/common';
import { DiscountCodesService } from './discount-codes.service';
import { CreateDiscountCodeDto, ValidateDiscountCodeDto } from './discount-codes.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';

@Controller('discount-codes')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class DiscountCodesController {
    constructor(private readonly service: DiscountCodesService) {}

    @Get()
    list(@Tenant() tenant: TenantContext) {
        return this.service.list(tenant.tenantId);
    }

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateDiscountCodeDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    @Post('validate')
    validate(@Tenant() tenant: TenantContext, @Body() dto: ValidateDiscountCodeDto) {
        return this.service.validate(tenant.tenantId, dto);
    }

    @Post(':code/use')
    recordUsage(@Tenant() tenant: TenantContext, @Param('code') code: string) {
        return this.service.recordUsage(tenant.tenantId, code);
    }

    @Patch(':id/toggle')
    toggle(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.toggle(tenant.tenantId, id);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
