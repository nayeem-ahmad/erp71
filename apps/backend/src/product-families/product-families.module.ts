import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ProductFamiliesController } from './product-families.controller';
import { ProductFamiliesService } from './product-families.service';

@Module({
    imports: [DatabaseModule],
    controllers: [ProductFamiliesController],
    providers: [ProductFamiliesService],
})
export class ProductFamiliesModule {}
