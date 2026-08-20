import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { HrReportsController } from './hr-reports.controller';
import { HrReportsService } from './hr-reports.service';

@Module({
    imports: [DatabaseModule],
    controllers: [HrReportsController],
    providers: [HrReportsService],
    exports: [HrReportsService],
})
export class HrReportsModule {}
