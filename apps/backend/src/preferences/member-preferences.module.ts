import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PreferencesService } from './preferences.service';

/**
 * Just the member-preference lookup, for the modules that read it (alerts,
 * notifications, sales settings). Kept apart from PreferencesModule so that
 * importing the lookup does not also mount the preference routes or pull in
 * the profile service's AuditService, which only the full app provides.
 */
@Module({
    imports: [DatabaseModule],
    providers: [PreferencesService],
    exports: [PreferencesService],
})
export class MemberPreferencesModule {}
