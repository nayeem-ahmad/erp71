import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PreferencesService } from './preferences.service';
import { PreferencesController } from './preferences.controller';
import { PreferenceProfilesService } from './preference-profiles.service';
import { PreferenceProfilesController } from './preference-profiles.controller';

@Module({
    imports: [DatabaseModule],
    controllers: [PreferencesController, PreferenceProfilesController],
    providers: [PreferencesService, PreferenceProfilesService],
    exports: [PreferencesService],
})
export class PreferencesModule {}
