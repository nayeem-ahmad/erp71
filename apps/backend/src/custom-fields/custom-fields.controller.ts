import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CustomFieldEntity } from '@prisma/client';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { CustomFieldsService } from './custom-fields.service';
import { SaveCustomFieldsDto } from './custom-fields.dto';

function parseEntity(entity?: string): CustomFieldEntity {
  if (entity === CustomFieldEntity.LEAD) return CustomFieldEntity.LEAD;
  throw new BadRequestException('Unsupported custom-field entity.');
}

@Controller('custom-fields')
@UseGuards(JwtAuthGuard, StorePermissionGuard)
@UseInterceptors(TenantInterceptor)
export class CustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}

  @Get()
  list(@Tenant() tenant: TenantContext, @Query('entity') entity?: string) {
    return this.service.listDefinitions(tenant.tenantId, parseEntity(entity));
  }

  @Put()
  @RequireStorePermission(StorePermission.MANAGE_CRM_SETTINGS)
  save(
    @Tenant() tenant: TenantContext,
    @Body() dto: SaveCustomFieldsDto,
    @Query('entity') entity?: string,
  ) {
    return this.service.saveDefinitions(tenant.tenantId, parseEntity(entity), dto);
  }
}
