import 'package:intl/intl.dart';

import '../../../core/api/api_client.dart';
import 'models.dart';

/// One page of a CRM list.
class Paged<T> {
  const Paged(this.items, {required this.total, required this.hasMore});

  final List<T> items;
  final int total;
  final bool hasMore;
}

/// The four tenant-configurable lists behind `/crm/lead-taxonomy/:kind`.
enum TaxonomyKind { sources, categories, channels, purposes }

/// Marks "leave this field as it is" in the `copyWith`s below, where null is
/// a real value (no filter).
const Object _keep = Object();

/// Filters for `GET /crm/leads`. That endpoint rejects unknown query
/// parameters with a 400, so only these are ever sent.
class LeadQuery {
  const LeadQuery({
    this.status = openStatus,
    this.search = '',
    this.mine = false,
    this.priority,
    this.staleDays,
  });

  /// The server's sentinel for NEW + CONTACTED + QUALIFIED.
  static const openStatus = 'open';

  /// `open`, a [LeadStatus.code], or null for every status.
  final String? status;
  final String search;
  final bool mine;
  final LeadPriority? priority;

  /// Only leads with no activity in this many days.
  final int? staleDays;

  LeadQuery copyWith({
    Object? status = _keep,
    String? search,
    bool? mine,
    Object? priority = _keep,
    Object? staleDays = _keep,
  }) => LeadQuery(
    status: status == _keep ? this.status : status as String?,
    search: search ?? this.search,
    mine: mine ?? this.mine,
    priority: priority == _keep ? this.priority : priority as LeadPriority?,
    staleDays: staleDays == _keep ? this.staleDays : staleDays as int?,
  );

  Map<String, Object?> toQuery() => {
    'status': status,
    'search': search.trim(),
    if (mine) 'mine': 'true',
    'priority': priority?.code,
    'staleDays': staleDays,
  };

  @override
  bool operator ==(Object other) =>
      other is LeadQuery &&
      other.status == status &&
      other.search == search &&
      other.mine == mine &&
      other.priority == priority &&
      other.staleDays == staleDays;

  @override
  int get hashCode => Object.hash(status, search, mine, priority, staleDays);
}

/// The Activities tab's views.
enum ActivityView {
  today('Today'),
  overdue('Overdue'),
  open('All open'),
  done('Done');

  const ActivityView(this.label);

  final String label;
}

class ActivityQuery {
  const ActivityQuery({this.view = ActivityView.today, this.mine = true});

  final ActivityView view;

  /// Assigned to me — the activity's assignee, not the lead's owner.
  final bool mine;

  Map<String, Object?> toQuery() => {
    if (mine) 'mine': 'true',
    ...switch (view) {
      // Both flags make the server force status=PLANNED itself.
      ActivityView.today => {'dueToday': 'true'},
      ActivityView.overdue => {'overdue': 'true'},
      ActivityView.open => {'status': ActivityStatus.planned.code},
      ActivityView.done => {
        'status': ActivityStatus.done.code,
        'sortBy': 'completed_at',
        'sortDir': 'desc',
      },
    },
  };

  @override
  bool operator ==(Object other) =>
      other is ActivityQuery && other.view == view && other.mine == mine;

  @override
  int get hashCode => Object.hash(view, mine);
}

class ContactQuery {
  const ContactQuery({this.search = '', this.mine = false});

  final String search;
  final bool mine;

  Map<String, Object?> toQuery() => {
    'search': search.trim(),
    if (mine) 'mine': 'true',
  };

  @override
  bool operator ==(Object other) =>
      other is ContactQuery && other.search == search && other.mine == mine;

  @override
  int get hashCode => Object.hash(search, mine);
}

/// A date and time the user picked on the workspace's wall clock.
///
/// Sent without an offset on purpose: the backend reads an offset-less
/// datetime in the workspace's own zone (`parseTenantDateTime`), which is
/// exactly what the user meant whatever zone the phone is set to.
String wallClockIso(DateTime wallClock) =>
    DateFormat("yyyy-MM-dd'T'HH:mm:00").format(wallClock);

class CrmRepository {
  CrmRepository(this._api);

  final ApiClient _api;

  static const pageSize = 20;

  // Leads ------------------------------------------------------------------

  Future<Paged<Lead>> leads(LeadQuery query, {int page = 1}) =>
      _page('/crm/leads', query.toQuery(), page, Lead.fromJson);

  Future<Lead> lead(String id) async =>
      Lead.fromJson(await _api.get('/crm/leads/$id') as Map<String, dynamic>);

  /// [fields] uses the API's names; empty values are left out, because the
  /// create endpoint treats several of them (`null` photo fields, `''`
  /// names) badly.
  Future<Lead> createLead(Map<String, Object?> fields) async {
    final body = {
      for (final entry in fields.entries)
        if (entry.value != null && entry.value != '') entry.key: entry.value,
    };
    return Lead.fromJson(
      await _api.post('/crm/leads', body: body) as Map<String, dynamic>,
    );
  }

  /// Sends exactly [changes]. The endpoint rejects unknown keys and treats
  /// `''` and `null` differently per field, so callers decide both.
  Future<Lead> updateLead(String id, Map<String, Object?> changes) async =>
      Lead.fromJson(
        await _api.patch('/crm/leads/$id', body: changes)
            as Map<String, dynamic>,
      );

  Future<Lead> setLeadStatus(
    String id,
    LeadStatus status, {
    String? lostReason,
  }) => updateLead(id, {
    'status': status.code,
    if (status == LeadStatus.lost) 'lost_reason': lostReason,
  });

  /// Closes the lead as won and creates the customer from it. (A PATCH to
  /// CONVERTED closes it too, but creates no customer — and a converted lead
  /// can never be edited again.)
  Future<Lead> convertLead(String id) async {
    final data =
        await _api.post('/crm/leads/$id/convert') as Map<String, dynamic>;
    return Lead.fromJson(data['lead'] as Map<String, dynamic>);
  }

  Future<void> deleteLead(String id) => _api.delete('/crm/leads/$id');

  // Activities -------------------------------------------------------------

  Future<Paged<Activity>> activities(ActivityQuery query, {int page = 1}) =>
      _page('/crm/activities', query.toQuery(), page, Activity.fromJson);

  /// A lead's timeline: planned first, soonest due at the top, then
  /// everything else newest first. Capped at a few pages to spare the rate
  /// limit; a lead with more history than that is shown its latest.
  Future<List<Activity>> leadActivities(String leadId) async {
    final all = <Activity>[];
    for (var page = 1; page <= 3; page++) {
      final result = await _api.getPage(
        '/crm/activities',
        query: {'leadId': leadId, 'page': page, 'limit': 100},
      );
      all.addAll(
        result.items.cast<Map<String, dynamic>>().map(Activity.fromJson),
      );
      if (!result.hasMore) break;
    }
    final planned = all.where((a) => a.isPlanned).toList()
      ..sort((a, b) => _compareDue(a.dueAt, b.dueAt));
    final rest = all.where((a) => !a.isPlanned).toList()
      ..sort(
        (a, b) => (b.completedAt ?? b.createdAt ?? DateTime(0)).compareTo(
          a.completedAt ?? a.createdAt ?? DateTime(0),
        ),
      );
    return [...planned, ...rest];
  }

  /// Records something that already happened — a call, a visit.
  Future<Activity> logActivity({
    required String leadId,
    required String channelId,
    required String summary,
    String? outcome,
    bool inbound = false,
  }) async => Activity.fromJson(
    await _api.post(
          '/crm/activities',
          body: {
            'lead_id': leadId,
            'status': ActivityStatus.done.code,
            'channel': channelId,
            'summary': summary,
            if (outcome != null && outcome.isNotEmpty) 'outcome': outcome,
            'direction': inbound ? 'INBOUND' : 'OUTBOUND',
          },
        )
        as Map<String, dynamic>,
  );

  /// Schedules a follow-up. It is assigned to the caller by default.
  Future<Activity> planActivity({
    required String leadId,
    required String subject,
    required DateTime dueAt,
    String? purposeId,
    String? notes,
  }) async => Activity.fromJson(
    await _api.post(
          '/crm/activities',
          body: {
            'lead_id': leadId,
            'status': ActivityStatus.planned.code,
            'subject': subject,
            'due_at': wallClockIso(dueAt),
            'purpose': ?purposeId,
            if (notes != null && notes.isNotEmpty) 'notes': notes,
          },
        )
        as Map<String, dynamic>,
  );

  /// Marks a planned activity done, recording what happened, and optionally
  /// schedules the next one in the same transaction.
  Future<Activity> completeActivity(
    String id, {
    required String channelId,
    required String summary,
    String? outcome,
    String? nextSubject,
    DateTime? nextDueAt,
  }) async {
    final data =
        await _api.post(
              '/crm/activities/$id/complete',
              body: {
                'channel': channelId,
                'summary': summary,
                if (outcome != null && outcome.isNotEmpty) 'outcome': outcome,
                if (nextSubject != null && nextDueAt != null)
                  'next': {
                    'subject': nextSubject,
                    'due_at': wallClockIso(nextDueAt),
                  },
              },
            )
            as Map<String, dynamic>;
    return Activity.fromJson(data['completed'] as Map<String, dynamic>);
  }

  Future<Activity> rescheduleActivity(String id, DateTime dueAt) async =>
      Activity.fromJson(
        await _api.patch(
              '/crm/activities/$id',
              body: {'due_at': wallClockIso(dueAt)},
            )
            as Map<String, dynamic>,
      );

  Future<Activity> cancelActivity(String id) async => Activity.fromJson(
    await _api.post('/crm/activities/$id/cancel') as Map<String, dynamic>,
  );

  // Contacts ---------------------------------------------------------------

  Future<Paged<Contact>> contacts(ContactQuery query, {int page = 1}) =>
      _page('/crm/contacts', query.toQuery(), page, Contact.fromJson);

  Future<Contact> contact(String id) async => Contact.fromJson(
    await _api.get('/crm/contacts/$id') as Map<String, dynamic>,
  );

  /// Empty values are left out: a `null` mobile is a 500 on create.
  Future<Contact> createContact(Map<String, String?> fields) async {
    final body = {
      for (final entry in fields.entries)
        if (entry.value != null && entry.value!.trim().isNotEmpty)
          entry.key: entry.value!.trim(),
    };
    return Contact.fromJson(
      await _api.post('/crm/contacts', body: body) as Map<String, dynamic>,
    );
  }

  /// On update `''` clears an optional field, so blanks are sent as blanks.
  Future<Contact> updateContact(
    String id,
    Map<String, String?> changes,
  ) async => Contact.fromJson(
    await _api.patch(
          '/crm/contacts/$id',
          body: {
            for (final entry in changes.entries)
              entry.key: entry.value?.trim() ?? '',
          },
        )
        as Map<String, dynamic>,
  );

  Future<void> deleteContact(String id) => _api.delete('/crm/contacts/$id');

  // Overview and lists -----------------------------------------------------

  /// The last 30 days (the server's default window).
  Future<CrmOverview> overview({required bool mine}) async =>
      CrmOverview.fromJson(
        await _api.get(
              '/crm/dashboard/overview',
              query: {if (mine) 'mine': 'true'},
            )
            as Map<String, dynamic>,
      );

  /// Active rows only, in the order the workspace arranged them.
  Future<List<CrmOption>> taxonomy(TaxonomyKind kind) async {
    final rows =
        await _api.get('/crm/lead-taxonomy/${kind.name}') as List<dynamic>;
    return [
      for (final row in rows)
        if (CrmOption.fromJson(row) case final option?)
          if (option.isActive) option,
    ];
  }

  Future<Paged<T>> _page<T>(
    String path,
    Map<String, Object?> query,
    int page,
    T Function(Map<String, dynamic>) parse,
  ) async {
    final result = await _api.getPage(
      path,
      query: {...query, 'page': page, 'limit': pageSize},
    );
    return Paged(
      result.items.cast<Map<String, dynamic>>().map(parse).toList(),
      total: result.total,
      hasMore: result.hasMore,
    );
  }

  static int _compareDue(DateTime? a, DateTime? b) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return a.compareTo(b);
  }
}
