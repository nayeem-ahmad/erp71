import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { MrrSnapshotService } from './mrr-snapshot.service';

/** The platform's MRR history: the nightly snapshot job and the readers over it. */
@Module({
    imports: [DatabaseModule],
    providers: [MrrSnapshotService],
    exports: [MrrSnapshotService],
})
export class MrrModule {}
