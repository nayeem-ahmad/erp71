import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';

@Module({
    imports: [DatabaseModule],
    controllers: [BrandsController],
    providers: [BrandsService],
    exports: [BrandsService],
})
export class BrandsModule {}
