import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import {
    CreateWarehouseTransferDto,
    ListWarehouseTransfersQueryDto,
    ReceiveWarehouseTransferDto,
    RejectWarehouseTransferDto,
} from './warehouse-transfer.dto';
import { WarehouseTransfersService } from './warehouse-transfers.service';

/**
 * Reads sit on VIEW_PRODUCT_CATALOG rather than on either transfer permission:
 * an approver holds APPROVE_GOODS_TRANSFER and need not hold
 * CREATE_GOODS_TRANSFER, and `StorePermissionGuard` requires *every* listed
 * permission — so naming both on the class would lock each side out of the
 * other's list. Same shape as `ProductDemandsController`, for the same reason.
 *
 * `receive` sits on CREATE_GOODS_TRANSFER: the matrix has no separate receive
 * permission, and the destination branch's stock clerk — who holds exactly this
 * one via the Inventory User template role — is who books the arrival.
 */
@Controller('warehouse-transfers')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@RequireStorePermission(StorePermission.VIEW_PRODUCT_CATALOG)
@UseInterceptors(TenantInterceptor)
export class WarehouseTransfersController {
    constructor(private readonly service: WarehouseTransfersService) {}

    @Post()
    @RequireStorePermission(StorePermission.CREATE_GOODS_TRANSFER)
    create(@Tenant() tenant: TenantContext, @Body() dto: CreateWarehouseTransferDto) {
        return this.service.create(tenant.tenantId, dto);
    }

    @Get()
    findAll(@Tenant() tenant: TenantContext, @Query() query: ListWarehouseTransfersQueryDto) {
        return this.service.findAll(tenant.tenantId, query);
    }

    @Get(':id')
    findOne(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.findOne(tenant.tenantId, id);
    }

    @Post(':id/send')
    @RequireStorePermission(StorePermission.CREATE_GOODS_TRANSFER)
    send(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.send(tenant.tenantId, id);
    }

    @Post(':id/approve')
    @RequireStorePermission(StorePermission.APPROVE_GOODS_TRANSFER)
    @HttpCode(HttpStatus.OK)
    approve(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.service.approve(tenant.tenantId, id, tenant.userId);
    }

    @Post(':id/reject')
    @RequireStorePermission(StorePermission.APPROVE_GOODS_TRANSFER)
    @HttpCode(HttpStatus.OK)
    reject(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: RejectWarehouseTransferDto,
    ) {
        return this.service.reject(tenant.tenantId, id, tenant.userId, dto);
    }

    @Post(':id/receive')
    @RequireStorePermission(StorePermission.CREATE_GOODS_TRANSFER)
    receive(@Tenant() tenant: TenantContext, @Param('id') id: string, @Body() dto: ReceiveWarehouseTransferDto) {
        return this.service.receive(tenant.tenantId, id, dto);
    }
}
