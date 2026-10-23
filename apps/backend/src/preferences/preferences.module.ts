import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MemberPreferencesModule } from './member-preferences.module';
import { PreferencesController } from './preferences.controller';
import { PreferenceProfilesService } from './preference-profiles.service';
import { PreferenceProfilesController } from './preference-profiles.controller';

/** The preference routes. Other modules import MemberPreferencesModule instead. */
@Module({
    imports: [DatabaseModule, MemberPreferencesModule],
    controllers: [PreferencesController, PreferenceProfilesController],
    providers: [PreferenceProfilesService],
})
export class PreferencesModule {}
