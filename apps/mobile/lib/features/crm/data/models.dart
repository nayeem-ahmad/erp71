import '../../../core/format/format.dart';
import '../../../ui/widgets.dart';

// Shapes of the CRM endpoints (apps/backend/src/crm-*). Scalar columns are
// snake_case, embedded relations camelCase (`assignee`, `sourceOption`), and
// every timestamp an ISO-8601 UTC string.

/// A lead's place in the pipeline — a fixed enum on the server, not a
/// configurable stage.
enum LeadStatus {
  newLead('NEW', 'New', Tone.primary),
  contacted('CONTACTED', 'Contacted', Tone.neutral),
  qualified('QUALIFIED', 'Qualified', Tone.neutral),
  lost('LOST', 'Lost', Tone.danger),
  converted('CONVERTED', 'Converted', Tone.success);

  const LeadStatus(this.code, this.label, this.tone);

  final String code;
  final String label;
  final Tone tone;

  bool get isOpen => this == newLead || this == contacted || this == qualified;

  static LeadStatus? parse(Object? code) {
    for (final status in values) {
      if (status.code == code) return status;
    }
    return null;
  }

  static const open = [newLead, contacted, qualified];
}

enum LeadPriority {
  low('LOW', 'Low', Tone.neutral),
  medium('MEDIUM', 'Medium', Tone.primary),
  high('HIGH', 'High', Tone.warning),
  urgent('URGENT', 'Urgent', Tone.danger);

  const LeadPriority(this.code, this.label, this.tone);

  final String code;
  final String label;
  final Tone tone;

  static LeadPriority? parse(Object? code) {
    for (final priority in values) {
      if (priority.code == code) return priority;
    }
    return null;
  }
}

/// The web's score bands: 70+ emerald, 40+ amber, the rest gray.
Tone scoreTone(int score) => score >= 70
    ? Tone.success
    : score >= 40
    ? Tone.warning
    : Tone.neutral;

/// `{id, name, email}` — how every relation to a user is embedded.
class UserRef {
  const UserRef({required this.id, this.name, this.email});

  static UserRef? fromJson(Object? json) => json is Map<String, dynamic>
      ? UserRef(
          id: json['id'] as String,
          name: json['name'] as String?,
          email: json['email'] as String?,
        )
      : null;

  final String id;
  final String? name;
  final String? email;

  String get displayName =>
      (name?.trim().isNotEmpty ?? false) ? name!.trim() : (email ?? 'Someone');
}

/// A row of one of the tenant-configurable lists: lead sources and
/// categories, activity channels and purposes.
class CrmOption {
  const CrmOption({
    required this.id,
    required this.code,
    required this.name,
    this.icon,
    this.isActive = true,
  });

  static CrmOption? fromJson(Object? json) => json is Map<String, dynamic>
      ? CrmOption(
          id: json['id'] as String,
          code: (json['code'] as String?) ?? '',
          name: (json['name'] as String?) ?? '',
          icon: json['icon'] as String?,
          isActive: json['is_active'] != false,
        )
      : null;

  final String id;
  final String code;
  final String name;

  /// An emoji, on channels and purposes.
  final String? icon;
  final bool isActive;

  String get label => icon == null || icon!.isEmpty ? name : '$icon $name';
}

class Lead {
  const Lead({
    required this.id,
    required this.name,
    required this.status,
    required this.priority,
    required this.score,
    this.mobile,
    this.email,
    this.address,
    this.remarks,
    this.lostReason,
    this.source,
    this.category,
    this.assignee,
    this.nextStep,
    this.nextStepDate,
    this.nextStepAssignee,
    this.nextActivityId,
    this.lastContactedAt,
    this.lastActivityAt,
    this.closedAt,
    this.createdAt,
    this.convertedCustomerName,
    this.websiteUrl,
    this.facebookUrl,
    this.linkedinUrl,
    this.xUrl,
  });

  factory Lead.fromJson(Map<String, dynamic> json) {
    final converted = json['convertedCustomer'];
    return Lead(
      id: json['id'] as String,
      name: (json['name'] as String?) ?? '',
      status: LeadStatus.parse(json['status']) ?? LeadStatus.newLead,
      priority: LeadPriority.parse(json['priority']) ?? LeadPriority.medium,
      score: (json['score'] as num?)?.toInt() ?? 0,
      mobile: _text(json['mobile']),
      email: _text(json['email']),
      address: _text(json['address']),
      remarks: _text(json['remarks']),
      lostReason: _text(json['lost_reason']),
      source: CrmOption.fromJson(json['sourceOption']),
      category: CrmOption.fromJson(json['categoryOption']),
      assignee: UserRef.fromJson(json['assignee']),
      nextStep: _text(json['next_step']),
      nextStepDate: parseInstant(json['next_step_date']),
      nextStepAssignee: UserRef.fromJson(json['nextStepAssignee']),
      nextActivityId: json['next_activity_id'] as String?,
      lastContactedAt: parseInstant(json['last_contacted_at']),
      lastActivityAt: parseInstant(json['last_activity_at']),
      closedAt: parseInstant(json['closed_at']),
      createdAt: parseInstant(json['created_at']),
      convertedCustomerName: converted is Map<String, dynamic>
          ? converted['name'] as String?
          : null,
      websiteUrl: _text(json['website_url']),
      facebookUrl: _text(json['fb_url']),
      linkedinUrl: _text(json['linkedin_url']),
      xUrl: _text(json['x_url']),
    );
  }

  final String id;
  final String name;
  final LeadStatus status;
  final LeadPriority priority;

  /// 0–100, recomputed by the server on writes only, so it can lag.
  final int score;
  final String? mobile;
  final String? email;
  final String? address;
  final String? remarks;
  final String? lostReason;
  final CrmOption? source;
  final CrmOption? category;

  /// The lead's owner.
  final UserRef? assignee;

  /// Read-only rollup of the earliest planned activity.
  final String? nextStep;
  final DateTime? nextStepDate;
  final UserRef? nextStepAssignee;
  final String? nextActivityId;

  final DateTime? lastContactedAt;
  final DateTime? lastActivityAt;
  final DateTime? closedAt;
  final DateTime? createdAt;
  final String? convertedCustomerName;
  final String? websiteUrl;
  final String? facebookUrl;
  final String? linkedinUrl;
  final String? xUrl;

  bool get isConverted => status == LeadStatus.converted;
}

class Contact {
  const Contact({
    required this.id,
    required this.name,
    this.company,
    this.designation,
    this.mobile,
    this.phone,
    this.email,
    this.address,
    this.websiteUrl,
    this.linkedinUrl,
    this.notes,
    this.captureSource,
    this.assignee,
    this.createdAt,
  });

  factory Contact.fromJson(Map<String, dynamic> json) => Contact(
    id: json['id'] as String,
    name: (json['name'] as String?) ?? '',
    company: _text(json['company']),
    designation: _text(json['designation']),
    mobile: _text(json['mobile']),
    phone: _text(json['phone']),
    email: _text(json['email']),
    address: _text(json['address']),
    websiteUrl: _text(json['website_url']),
    linkedinUrl: _text(json['linkedin_url']),
    notes: _text(json['notes']),
    captureSource: json['capture_source'] as String?,
    assignee: UserRef.fromJson(json['assignee']),
    createdAt: parseInstant(json['created_at']),
  );

  final String id;
  final String name;
  final String? company;
  final String? designation;
  final String? mobile;
  final String? phone;
  final String? email;
  final String? address;
  final String? websiteUrl;
  final String? linkedinUrl;
  final String? notes;

  /// `MANUAL`, `BUSINESS_CARD` or `IMPORT`.
  final String? captureSource;
  final UserRef? assignee;
  final DateTime? createdAt;

  /// "Buyer · Acme Ltd", or whichever half exists.
  String? get roleLine {
    final parts = [designation, company].whereType<String>().toList();
    return parts.isEmpty ? null : parts.join(' · ');
  }
}

enum ActivityStatus {
  planned('PLANNED', 'Planned'),
  done('DONE', 'Done'),
  cancelled('CANCELLED', 'Cancelled');

  const ActivityStatus(this.code, this.label);

  final String code;
  final String label;

  static ActivityStatus parse(Object? code) {
    for (final status in values) {
      if (status.code == code) return status;
    }
    return planned;
  }
}

/// A task (PLANNED) or a logged touch (DONE) on a lead or a customer — the
/// one model behind the web's Activities page and every lead timeline.
class Activity {
  const Activity({
    required this.id,
    required this.status,
    this.subject,
    this.summary,
    this.outcome,
    this.notes,
    this.direction = 'OUTBOUND',
    this.dueAt,
    this.completedAt,
    this.createdAt,
    this.leadId,
    this.leadName,
    this.leadMobile,
    this.customerId,
    this.customerName,
    this.customerPhone,
    this.purpose,
    this.channel,
    this.assignee,
    this.creator,
  });

  factory Activity.fromJson(Map<String, dynamic> json) {
    final lead = json['lead'];
    final customer = json['customer'];
    return Activity(
      id: json['id'] as String,
      status: ActivityStatus.parse(json['status']),
      subject: _text(json['subject']),
      summary: _text(json['summary']),
      outcome: _text(json['outcome']),
      notes: _text(json['notes']),
      direction: (json['direction'] as String?) ?? 'OUTBOUND',
      dueAt: parseInstant(json['due_at']),
      completedAt: parseInstant(json['completed_at']),
      createdAt: parseInstant(json['created_at']),
      leadId: json['lead_id'] as String?,
      leadName: lead is Map<String, dynamic> ? lead['name'] as String? : null,
      leadMobile: lead is Map<String, dynamic> ? _text(lead['mobile']) : null,
      customerId: json['customer_id'] as String?,
      customerName: customer is Map<String, dynamic>
          ? customer['name'] as String?
          : null,
      customerPhone: customer is Map<String, dynamic>
          ? _text(customer['phone'])
          : null,
      purpose: CrmOption.fromJson(json['purpose']),
      channel: CrmOption.fromJson(json['channel']),
      assignee: UserRef.fromJson(json['assignee']),
      creator: UserRef.fromJson(json['creator']),
    );
  }

  final String id;
  final ActivityStatus status;

  /// The planned title; null on activities logged directly.
  final String? subject;

  /// What happened; set once DONE.
  final String? summary;
  final String? outcome;
  final String? notes;

  /// `OUTBOUND` or `INBOUND`.
  final String direction;
  final DateTime? dueAt;
  final DateTime? completedAt;
  final DateTime? createdAt;
  final String? leadId;
  final String? leadName;
  final String? leadMobile;
  final String? customerId;
  final String? customerName;
  final String? customerPhone;
  final CrmOption? purpose;
  final CrmOption? channel;
  final UserRef? assignee;
  final UserRef? creator;

  /// The web's rule: show the subject, else what was logged.
  String get title => subject ?? summary ?? 'Activity';

  String? get targetName => leadName ?? customerName;
  String? get targetPhone => leadMobile ?? customerPhone;
  bool get isPlanned => status == ActivityStatus.planned;

  /// Planned and due before the start of the workspace's today — the
  /// server's definition of overdue.
  bool isOverdue({DateTime? now}) {
    final due = dueAt;
    if (!isPlanned || due == null) return false;
    return calendarDaysBetween(now ?? workspaceNow(), inWorkspaceZone(due)) < 0;
  }
}

/// `GET /crm/dashboard/overview`, reduced to what the phone shows.
class CrmOverview {
  const CrmOverview({
    required this.statusCounts,
    required this.open,
    required this.createdInPeriod,
    required this.convertedInPeriod,
    required this.lostInPeriod,
    required this.unassigned,
    required this.stale,
    required this.staleAfterDays,
    required this.dueToday,
    required this.overdue,
    required this.totalPending,
    required this.loggedInPeriod,
    this.conversionRatePct,
  });

  factory CrmOverview.fromJson(Map<String, dynamic> json) {
    final pipeline = _map(json['pipeline']);
    final followUps = _map(json['follow_ups']);
    final activity = _map(json['activity']);
    final counts = _map(pipeline['counts']);
    int n(Map<String, dynamic> m, String key) => (m[key] as num?)?.toInt() ?? 0;
    return CrmOverview(
      statusCounts: {
        for (final status in LeadStatus.values) status: n(counts, status.code),
      },
      open: n(pipeline, 'open'),
      createdInPeriod: n(pipeline, 'created_in_period'),
      convertedInPeriod: n(pipeline, 'converted_in_period'),
      lostInPeriod: n(pipeline, 'lost_in_period'),
      conversionRatePct: (pipeline['conversion_rate_pct'] as num?)?.toDouble(),
      unassigned: n(pipeline, 'unassigned'),
      stale: n(pipeline, 'stale'),
      staleAfterDays: (pipeline['stale_after_days'] as num?)?.toInt() ?? 14,
      dueToday: n(followUps, 'due_today'),
      overdue: n(followUps, 'overdue'),
      totalPending: n(followUps, 'total_pending'),
      loggedInPeriod: n(activity, 'logged_in_period'),
    );
  }

  /// The whole book, not windowed.
  final Map<LeadStatus, int> statusCounts;
  final int open;

  /// The last 30 days, the dashboard's default window.
  final int createdInPeriod;
  final int convertedInPeriod;
  final int lostInPeriod;
  final double? conversionRatePct;
  final int unassigned;

  /// Open leads with no activity in [staleAfterDays] days.
  final int stale;
  final int staleAfterDays;
  final int dueToday;
  final int overdue;
  final int totalPending;
  final int loggedInPeriod;
}

Map<String, dynamic> _map(Object? value) =>
    value is Map<String, dynamic> ? value : const {};

/// Blank strings read as absent: the server keeps `''` in some columns.
String? _text(Object? value) =>
    value is String && value.trim().isNotEmpty ? value.trim() : null;
