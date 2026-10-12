import type { RecordHistoryAction, RecordHistoryEntityType } from '@erp71/shared-types';
import type { DatabaseService } from '../database/database.service';

export const TRACK_HISTORY_KEY = 'record-history:track';

/** How a `@TrackHistory` route finds the record it changes. */
export interface TrackHistoryOptions {
    action: RecordHistoryAction;
    /**
     * Route param naming the record, read before the handler runs so the
     * "before" snapshot exists. Defaults to `id`. Ignored on `CREATE`, where
     * the record does not exist yet and `:id` usually names its parent.
     */
    idParam?: string;
    /**
     * For a route whose param is not the tracked record — removing a supplier
     * payment's allocation names the allocation, not the payment. Runs before
     * the handler.
     */
    resolveId?: (db: DatabaseService, request: { params: Record<string, string> }) => Promise<string | null | undefined>;
    /** For a `CREATE` that makes several records. Defaults to the result's `id`. */
    resultIds?: (result: any) => string[];
}

export interface TrackHistorySpec extends TrackHistoryOptions {
    entity: RecordHistoryEntityType;
}
