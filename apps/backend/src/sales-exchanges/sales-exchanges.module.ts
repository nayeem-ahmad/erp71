import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MushakModule } from '../mushak/mushak.module';
import { SalesExchangesController } from './sales-exchanges.controller';
import { SalesExchangesService } from './sales-exchanges.service';

@Module({
    imports: [DatabaseModule, MushakModule],
    controllers: [SalesExchangesController],
    providers: [SalesExchangesService],
})
export class SalesExchangesModule {}
