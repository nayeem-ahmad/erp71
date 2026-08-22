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
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { ImportsService } from './imports.service';
import {
    CreateImportCostDto,
    CreateImportDocumentDto,
    CreateImportShipmentDto,
    ListShipmentsQueryDto,
    ReceiveShipmentDto,
    SettleShipmentDto,
    UpdateImportCostDto,
    UpdateImportShipmentDto,
    UpdateShipmentStatusDto,
} from './imports.dto';

/**
 * `VIEW_IMPORTS` gates the controller; writes need `MANAGE_IMPORTS` on top, and
 * anything that changes what the goods cost needs `MANAGE_IMPORT_COSTS`.
 *
 * That third permission is not ceremony. Adding an import cost changes the
 * landed cost of the shipment and therefore the COGS on every subsequent sale
 * of those goods — a finance action, not a warehouse one. Receiving a shipment
 * is gated the same way, because receipt is the moment the landed cost is
 * written into the cost pool for good.
 */
@Controller('imports')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.VIEW_IMPORTS)
@UseInterceptors(TenantInterceptor)
export class ImportsController {
    constructor(private readonly imports: ImportsService) {}

    // ── Reports ──────────────────────────────────────────────────────────────
    // Declared before `:id`, or that route captures them.

    @Get('lc-register')
    lcRegister(@Tenant() tenant: TenantContext, @Query('days') days?: string) {
        return this.imports.lcRegister(tenant.tenantId, days ? Number(days) : undefined);
    }

    @Get('duty-report')
    dutyReport(
        @Tenant() tenant: TenantContext,
        @Query('from') from?: string,
        @Query('to') to?: string,
    ) {
        return this.imports.dutyReport(tenant.tenantId, { from, to });
    }

    @Get('bank-limits')
    bankLimits(@Tenant() tenant: TenantContext) {
        return this.imports.bankLimitUtilisation(tenant.tenantId);
    }

    // ── Shipments ────────────────────────────────────────────────────────────

    @Post()
    @RequireStorePermission(StorePermission.MANAGE_IMPORTS)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateImportShipmentDto) {
        return this.imports.create(tenant.tenantId, tenant.userId, dto);
    }

    @Get()
    findAll(@Tenant() tenant: TenantContext, @Query() query: ListShipmentsQueryDto) {
        return this.imports.findAll(tenant.tenantId, {
            status: query.status,
            supplierId: query.supplierId,
            openOnly: query.openOnly === 'true',
        });
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.imports.findOne(tenant.tenantId, id);
    }

    @Patch(':id')
    @RequireStorePermission(StorePermission.MANAGE_IMPORTS)
    update(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateImportShipmentDto,
    ) {
        return this.imports.update(tenant.tenantId, id, dto);
    }

    @Patch(':id/status')
    @RequireStorePermission(StorePermission.MANAGE_IMPORTS)
    updateStatus(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateShipmentStatusDto,
    ) {
        return this.imports.updateStatus(tenant.tenantId, id, dto.status);
    }

    @Delete(':id')
    @RequireStorePermission(StorePermission.MANAGE_IMPORTS)
    remove(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.imports.remove(tenant.tenantId, id);
    }

    // ── Costs ────────────────────────────────────────────────────────────────

    @Get(':id/cost-sheet')
    costSheet(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.imports.costSheet(tenant.tenantId, id);
    }

    @Post(':id/costs')
    @RequireStorePermission(StorePermission.MANAGE_IMPORT_COSTS)
    addCost(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CreateImportCostDto,
    ) {
        return this.imports.addCost(tenant.tenantId, tenant.userId, id, dto);
    }

    @Patch(':id/costs/:costId')
    @RequireStorePermission(StorePermission.MANAGE_IMPORT_COSTS)
    updateCost(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('costId') costId: string,
        @Body() dto: UpdateImportCostDto,
    ) {
        return this.imports.updateCost(tenant.tenantId, id, costId, dto);
    }

    @Delete(':id/costs/:costId')
    @RequireStorePermission(StorePermission.MANAGE_IMPORT_COSTS)
    removeCost(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('costId') costId: string,
    ) {
        return this.imports.removeCost(tenant.tenantId, id, costId);
    }

    // ── Receipt and settlement ───────────────────────────────────────────────

    @Post(':id/receive')
    @RequireStorePermission(StorePermission.MANAGE_IMPORT_COSTS)
    receive(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: ReceiveShipmentDto,
    ) {
        return this.imports.receive(tenant.tenantId, tenant.userId, id, dto);
    }

    @Post(':id/settle')
    @RequireStorePermission(StorePermission.MANAGE_IMPORT_COSTS)
    settle(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: SettleShipmentDto,
    ) {
        return this.imports.settle(tenant.tenantId, id, dto);
    }

    // ── Documents ────────────────────────────────────────────────────────────

    @Post(':id/documents')
    @RequireStorePermission(StorePermission.MANAGE_IMPORTS)
    addDocument(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: CreateImportDocumentDto,
    ) {
        return this.imports.addDocument(tenant.tenantId, tenant.userId, id, dto);
    }

    @Delete(':id/documents/:documentId')
    @RequireStorePermission(StorePermission.MANAGE_IMPORTS)
    removeDocument(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('documentId') documentId: string,
    ) {
        return this.imports.removeDocument(tenant.tenantId, id, documentId);
    }
}
