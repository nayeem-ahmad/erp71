import { Controller, Post, Get, Patch, Delete, Body, Param, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { PaginationDto } from '../common/pagination.dto';
import { TerritoriesService } from './territories.service';
import { CreateTerritoryDto, UpdateTerritoryDto } from './territory.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ImportRowsDto } from '../common/import.dto';

@Controller('territories')
@UseGuards(JwtAuthGuard)
@UseInterceptors(TenantInterceptor)
export class TerritoriesController {
    constructor(private readonly service: TerritoriesService) {}

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateTerritoryDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    @Post('import')
    importRows(@Tenant() tenant: TenantContext, @Body() body: ImportRowsDto) {
        return this.service.importRows(tenant.tenantId, body.rows, body.mode);
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
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateTerritoryDto) {
        return this.service.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.remove(tenant.tenantId, id);
    }
}
