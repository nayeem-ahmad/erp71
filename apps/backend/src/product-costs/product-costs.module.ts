import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ProductCostsController } from './product-costs.controller';
import { ProductCostsService } from './product-costs.service';

@Module({
    imports: [DatabaseModule],
    controllers: [ProductCostsController],
    providers: [ProductCostsService],
})
export class ProductCostsModule {}
