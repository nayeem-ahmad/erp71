import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { CHEQUE_READ, CHEQUE_WRITE } from '../auth/permission-sets';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CreateChequeDto, ListChequesQueryDto, UpdateChequeDto } from './cheques.dto';
import { ChequesService } from './cheques.service';

/** Tools → Cheques: the register of cheques written and received. */
@Controller('cheques')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class ChequesController {
    constructor(private readonly cheques: ChequesService) {}

    @RequireAnyStorePermission(...CHEQUE_READ)
    @Get()
    findAll(@Tenant() tenant: TenantContext, @Query() query: ListChequesQueryDto) {
        return this.cheques.findAll(tenant, query);
    }

    @RequireAnyStorePermission(...CHEQUE_READ)
    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.cheques.findOne(tenant, id);
    }

    @RequireAnyStorePermission(...CHEQUE_WRITE)
    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateChequeDto) {
        return this.cheques.create(tenant, dto);
    }

    @RequireAnyStorePermission(...CHEQUE_WRITE)
    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateChequeDto) {
        return this.cheques.update(tenant, id, dto);
    }

    @RequireAnyStorePermission(...CHEQUE_WRITE)
    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.cheques.remove(tenant, id);
    }
}
