import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';

@Module({
    imports: [DatabaseModule],
    controllers: [PurchaseOrdersController],
    providers: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
