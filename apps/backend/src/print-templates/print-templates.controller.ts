import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { PrintTemplatesService } from './print-templates.service';
import {
    CreatePrintTemplateDto,
    PrintTemplateResponseDto,
    ResolvePrintTemplateQueryDto,
    ResolvedPrintTemplateDto,
    UpdatePrintTemplateDto,
} from './print-templates.dto';

import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { PRINT_READ, SETTINGS_ADMIN } from '../auth/permission-sets';
@Controller('print-templates')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class PrintTemplatesController {
    constructor(private readonly printTemplatesService: PrintTemplatesService) { }

    @RequireAnyStorePermission(...PRINT_READ)
    @Get()
    async list(@Tenant() tenant: TenantContext): Promise<PrintTemplateResponseDto[]> {
        return this.printTemplatesService.list(tenant.tenantId);
    }

    /** Effective header config for a document type — what printers call. */
    @RequireAnyStorePermission(...PRINT_READ)
    @Get('resolve')
    async resolve(
        @Tenant() tenant: TenantContext,
        @Query() query: ResolvePrintTemplateQueryDto,
    ): Promise<ResolvedPrintTemplateDto> {
        return this.printTemplatesService.resolve(tenant.tenantId, query.docType);
    }

    @RequireAnyStorePermission(...PRINT_READ)
    @Get(':id')
    async get(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
    ): Promise<PrintTemplateResponseDto> {
        return this.printTemplatesService.get(tenant.tenantId, id);
    }

    @RequireAnyStorePermission(...SETTINGS_ADMIN)
    @Post()
    async create(
        @Tenant() tenant: TenantContext,
        @Body() dto: CreatePrintTemplateDto,
    ): Promise<PrintTemplateResponseDto> {
        return this.printTemplatesService.create(tenant.tenantId, dto);
    }

    @RequireAnyStorePermission(...SETTINGS_ADMIN)
    @Patch(':id')
    async update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdatePrintTemplateDto,
    ): Promise<PrintTemplateResponseDto> {
        return this.printTemplatesService.update(tenant.tenantId, id, dto);
    }

    @RequireAnyStorePermission(...SETTINGS_ADMIN)
    @Delete(':id')
    async remove(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
    ): Promise<{ success: true }> {
        return this.printTemplatesService.remove(tenant.tenantId, id);
    }
}
