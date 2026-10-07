import { Body, Controller, Get, Param, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { SETTINGS_ADMIN } from '../auth/permission-sets';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { DocumentNumberingService } from './document-numbering.service';
import { DocumentNumberingResponse, UpdateDocumentNumberingDto } from './document-numbering.dto';

/**
 * Settings → Document Numbering. Both routes are admin-only: the read shows
 * every branch's code and counter, and the write changes what every document
 * of that type is called from now on.
 */
@Controller('document-numbering')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class DocumentNumberingController {
    constructor(private readonly numbering: DocumentNumberingService) {}

    @RequireAnyStorePermission(...SETTINGS_ADMIN)
    @Get(':docType')
    async get(
        @Tenant() tenant: TenantContext,
        @Param('docType') docType: string,
    ): Promise<DocumentNumberingResponse> {
        return this.numbering.get(tenant.tenantId, docType);
    }

    @RequireAnyStorePermission(...SETTINGS_ADMIN)
    @Put(':docType')
    async update(
        @Tenant() tenant: TenantContext,
        @Param('docType') docType: string,
        @Body() dto: UpdateDocumentNumberingDto,
    ): Promise<DocumentNumberingResponse> {
        return this.numbering.update(tenant, docType, dto);
    }
}
