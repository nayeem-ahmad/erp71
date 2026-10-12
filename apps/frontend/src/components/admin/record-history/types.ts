/** One row of `GET /admin/record-history` — the list view, without snapshots. */
export interface RecordHistoryRow {
    id: string;
    tenant_id: string;
    tenant_name: string | null;
    entity_type: string;
    entity_id: string;
    entity_label: string | null;
    action: string;
    change_count: number;
    changed_paths: string[];
    ip_address: string | null;
    created_at: string;
    user: { id: string; name: string | null; email: string } | null;
}
