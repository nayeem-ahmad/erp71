import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EmployeesModule } from '../employees/employees.module';
import { RecruitmentController } from './recruitment.controller';
import { RecruitmentService } from './recruitment.service';

@Module({
    imports: [DatabaseModule, EmployeesModule],
    controllers: [RecruitmentController],
    providers: [RecruitmentService],
    exports: [RecruitmentService],
})
export class RecruitmentModule {}
