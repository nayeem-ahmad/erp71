import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CreateSupplierDto, UpdateSupplierDto } from './supplier.dto';
import { SuppliersService } from './suppliers.service';

@Controller('suppliers')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class SuppliersController {
    constructor(private readonly suppliersService: SuppliersService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateSupplierDto) {
        return this.suppliersService.create(tenant.tenantId, dto);
    }

    @Get()
    findAll(@Tenant() tenant: TenantContext) {
        return this.suppliersService.findAll(tenant.tenantId);
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.suppliersService.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateSupplierDto) {
        return this.suppliersService.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.suppliersService.remove(tenant.tenantId, id);
    }
}