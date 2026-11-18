import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { NpsService } from './nps.service';
import { OwnerNpsController, PublicNpsController } from './nps.controller';

/** Net Promoter Score: the receipt survey, the owner question, and the totals the KPI scorecard reads. */
@Module({
    imports: [DatabaseModule],
    controllers: [PublicNpsController, OwnerNpsController],
    providers: [NpsService],
    exports: [NpsService],
})
export class NpsModule {}
