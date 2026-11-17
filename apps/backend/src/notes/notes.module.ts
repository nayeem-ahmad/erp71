import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';

@Module({
    imports: [AssetsModule],
    controllers: [NotesController],
    providers: [NotesService],
})
export class NotesModule {}
