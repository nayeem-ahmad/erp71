import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@/shared/auth/jwt-auth.guard';
import { TenantInterceptor } from '@/shared/interceptors/tenant.interceptor';
import { CurrentTenant } from '@/shared/decorators/current-tenant.decorator';
import { PaymentMethodsService } from './payment-methods.service';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
  PaymentMethodResponseDto,
  PaymentMethodType,
} from './payment-methods.dto';

@Controller('payment-methods')
@UseGuards(JwtAuthGuard)
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Post()
  async create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    return this.paymentMethodsService.create(tenantId, dto);
  }

  @Get()
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query('type') type?: PaymentMethodType,
  ): Promise<PaymentMethodResponseDto[]> {
    return this.paymentMethodsService.findAll(tenantId, type);
  }

  @Get('default/:type')
  async getDefault(
    @CurrentTenant() tenantId: string,
    @Param('type') type: PaymentMethodType,
  ): Promise<PaymentMethodResponseDto | null> {
    return this.paymentMethodsService.getDefaultByType(tenantId, type);
  }

  @Get(':id')
  async findOne(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ): Promise<PaymentMethodResponseDto> {
    return this.paymentMethodsService.findById(id, tenantId);
  }

  @Patch(':id')
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    return this.paymentMethodsService.update(id, tenantId, dto);
  }

  @Delete(':id')
  async delete(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.paymentMethodsService.delete(id, tenantId);
  }
}
