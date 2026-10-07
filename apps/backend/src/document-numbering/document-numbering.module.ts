import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { DocumentNumberingController } from './document-numbering.controller';
import { DocumentNumberingService } from './document-numbering.service';

@Module({
    imports: [DatabaseModule],
    controllers: [DocumentNumberingController],
    providers: [DocumentNumberingService],
})
export class DocumentNumberingModule {}
