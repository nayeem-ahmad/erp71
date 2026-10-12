import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import type { RecordHistoryEntityType } from '@erp71/shared-types';
import { RecordHistoryInterceptor } from './record-history.interceptor';
import { TRACK_HISTORY_KEY, type TrackHistoryOptions, type TrackHistorySpec } from './track-history.metadata';

/**
 * Keep a before/after history of the record this route changes, for platform
 * admins (Admin → Record History). Whether a row is written is decided at
 * request time by the `record_history` platform settings.
 *
 * Put it on the handler, not the controller: each route says which record it
 * changes and how, and a controller's read routes have nothing to record.
 */
export function TrackHistory(entity: RecordHistoryEntityType, options: TrackHistoryOptions) {
    const spec: TrackHistorySpec = { entity, ...options };
    return applyDecorators(SetMetadata(TRACK_HISTORY_KEY, spec), UseInterceptors(RecordHistoryInterceptor));
}
