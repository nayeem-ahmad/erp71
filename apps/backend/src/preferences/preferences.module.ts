import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PreferencesService } from './preferences.service';
import { PreferencesController } from './preferences.controller';

@Module({
    imports: [DatabaseModule],
    controllers: [PreferencesController],
    providers: [PreferencesService],
    exports: [PreferencesService],
})
export class PreferencesModule {}
