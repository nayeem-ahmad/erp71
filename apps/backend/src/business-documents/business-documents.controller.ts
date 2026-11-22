import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireAnyStorePermission } from '../auth/store-permission.decorator';
import { BUSINESS_DOCUMENTS } from '../auth/permission-sets';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import {
    CreateBusinessDocumentDto,
    UpdateBusinessDocumentDto,
    UploadBusinessDocumentFileDto,
} from './business-documents.dto';
import { BusinessDocumentsService } from './business-documents.service';

/** Tools → Documents: the business's licences and registrations, with their expiry dates. */
@Controller('business-documents')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
@RequireAnyStorePermission(...BUSINESS_DOCUMENTS)
export class BusinessDocumentsController {
    constructor(private readonly documents: BusinessDocumentsService) {}

    @Get()
    findAll(@Tenant() tenant: TenantContext) {
        return this.documents.findAll(tenant.tenantId);
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.documents.findOne(tenant.tenantId, id);
    }

    @Post()
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateBusinessDocumentDto) {
        return this.documents.create(tenant.tenantId, tenant.userId, dto);
    }

    @Patch(':id')
    update(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UpdateBusinessDocumentDto) {
        return this.documents.update(tenant.tenantId, id, dto);
    }

    @Delete(':id')
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.documents.remove(tenant.tenantId, id);
    }

    /** The scanned copy. Throttled: the body is a file. */
    @Put(':id/file')
    @Throttle({ default: { limit: 20, ttl: 60_000 } })
    uploadFile(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: UploadBusinessDocumentFileDto) {
        return this.documents.uploadFile(tenant.tenantId, id, dto);
    }

    @Delete(':id/file')
    removeFile(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.documents.removeFile(tenant.tenantId, id);
    }
}
