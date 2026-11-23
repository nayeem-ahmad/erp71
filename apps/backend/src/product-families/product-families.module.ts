import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ProductsModule } from '../products/products.module';
import { ProductFamiliesController } from './product-families.controller';
import { ProductFamiliesService } from './product-families.service';

@Module({
    imports: [DatabaseModule, ProductsModule],
    controllers: [ProductFamiliesController],
    providers: [ProductFamiliesService],
})
export class ProductFamiliesModule {}
