import { Module } from '@nestjs/common';
import { PrismaService } from '@/shared/prisma/prisma.service';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodsController } from './payment-methods.controller';

@Module({
  controllers: [PaymentMethodsController],
  providers: [PaymentMethodsService, PrismaService],
  exports: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
