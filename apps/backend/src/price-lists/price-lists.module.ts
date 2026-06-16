import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PriceListsService } from './price-lists.service';
import { PriceListsController } from './price-lists.controller';

@Module({
    imports: [DatabaseModule],
    controllers: [PriceListsController],
    providers: [PriceListsService],
    exports: [PriceListsService],
})
export class PriceListsModule {}