import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PriceListsModule } from '../price-lists/price-lists.module';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';

@Module({
    imports: [DatabaseModule, PriceListsModule],
    controllers: [ProductsController],
    providers: [ProductsService],
})
export class ProductsModule { }
