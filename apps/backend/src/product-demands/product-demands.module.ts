import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ProductDemandsController } from './product-demands.controller';
import { ProductDemandsService } from './product-demands.service';

@Module({
    imports: [DatabaseModule],
    controllers: [ProductDemandsController],
    providers: [ProductDemandsService],
})
export class ProductDemandsModule {}
