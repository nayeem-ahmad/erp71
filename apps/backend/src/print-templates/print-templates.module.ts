import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PrintTemplatesService } from './print-templates.service';
import { PrintTemplatesController } from './print-templates.controller';

@Module({
    imports: [DatabaseModule],
    controllers: [PrintTemplatesController],
    providers: [PrintTemplatesService],
    exports: [PrintTemplatesService],
})
export class PrintTemplatesModule { }
