import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PriceListsModule } from '../price-lists/price-lists.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({
    imports: [DatabaseModule, PriceListsModule, SubscriptionPlansModule],
    controllers: [ProductsController],
    providers: [ProductsService],
    exports: [ProductsService],
})
export class ProductsModule { }
