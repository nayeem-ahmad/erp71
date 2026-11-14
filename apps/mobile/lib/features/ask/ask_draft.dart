/// A task or lead the assistant understood and did not save.
///
/// The shape matches `AiCreateDraft` on the web. The card edits it and the
/// existing create endpoint writes it when the person presses Save.
enum AskDraftKind { task, lead }

class AskChoice {
  const AskChoice({
    required this.id,
    required this.label,
    this.detail,
    this.kind,
  });

  final String id;
  final String label;
  final String? detail;

  /// `user` or `employee` on an assignee. Projects leave this empty.
  final String? kind;

  String get menuLabel =>
      detail == null || detail!.isEmpty ? label : '$label ($detail)';

  /// Dropdown value for an assignee. Projects use [id] on its own.
  String get value => '${kind ?? 'user'}:$id';
}

class AskDraftFields {
  const AskDraftFields({
    this.title,
    this.description,
    this.projectId,
    this.projectName,
    this.projectChoices = const [],
    this.assigneeId,
    this.assigneeEmployeeId,
    this.assigneeName,
    this.assigneeChoices = const [],
    this.assigneeUnresolved = false,
    this.dueDate,
    this.priority,
    this.name,
    this.mobile,
    this.email,
    this.remarks,
  });

  final String? title;
  final String? description;
  final String? projectId;
  final String? projectName;
  final List<AskChoice> projectChoices;
  final String? assigneeId;
  final String? assigneeEmployeeId;
  final String? assigneeName;
  final List<AskChoice> assigneeChoices;
  final bool assigneeUnresolved;
  final String? dueDate;
  final String? priority;
  final String? name;
  final String? mobile;
  final String? email;
  final String? remarks;
}

class AskDraft {
  const AskDraft({
    required this.kind,
    this.status = 'ready',
    this.missing = const [],
    this.warnings = const [],
    required this.fields,
  });

  final AskDraftKind kind;
  final String status;
  final List<String> missing;
  final List<String> warnings;
  final AskDraftFields fields;

  static AskDraft? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final kind = switch (raw['kind']) {
      'task' => AskDraftKind.task,
      'lead' => AskDraftKind.lead,
      _ => null,
    };
    final fields = raw['fields'];
    if (kind == null || fields is! Map) return null;
    return AskDraft(
      kind: kind,
      status: _text(raw['status']) ?? 'ready',
      missing: _strings(raw['missing']),
      warnings: _strings(raw['warnings']),
      fields: AskDraftFields(
        title: _text(fields['title']),
        description: _text(fields['description']),
        projectId: _text(fields['projectId']),
        projectName: _text(fields['projectName']),
        projectChoices: _choices(fields['projectChoices']),
        assigneeId: _text(fields['assigneeId']),
        assigneeEmployeeId: _text(fields['assigneeEmployeeId']),
        assigneeName: _text(fields['assigneeName']),
        assigneeChoices: _choices(fields['assigneeChoices']),
        assigneeUnresolved: fields['assigneeUnresolved'] == true,
        dueDate: _date(fields['dueDate']),
        priority: _priority(fields['priority']),
        name: _text(fields['name']),
        mobile: _text(fields['mobile']),
        email: _text(fields['email']),
        remarks: _text(fields['remarks']),
      ),
    );
  }
}

const askPriorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const taskTool = 'propose_create_task';
const leadTool = 'propose_create_lead';

/// Drafts on one assistant message. A lookup tool call has none.
List<AskDraft> parseDrafts(Object? toolCalls) {
  if (toolCalls is! List) return const [];
  final drafts = <AskDraft>[];
  for (final call in toolCalls) {
    if (call is! Map) continue;
    final draft = AskDraft.tryParse(call['draft']);
    if (draft != null) drafts.add(draft);
  }
  return drafts;
}

/// Hide the card until the tool list is known, and whenever this person
/// cannot save that kind. A draft the server still attached stays off screen.
bool draftIsOffered(bool toolsReady, Set<String>? tools, AskDraft draft) {
  if (!toolsReady || tools == null) return false;
  final name = draft.kind == AskDraftKind.task ? taskTool : leadTool;
  return tools.contains(name);
}

String initialPriority(AskDraft draft) {
  final value = draft.fields.priority;
  return value != null && askPriorities.contains(value) ? value : 'MEDIUM';
}

/// Empty when they named someone and it did not resolve. Otherwise
/// `unassigned`, `user:<id>`, or `employee:<id>`.
String assigneeValueOf(AskDraft draft) {
  final fields = draft.fields;
  if (fields.assigneeId != null) return 'user:${fields.assigneeId}';
  if (fields.assigneeEmployeeId != null) {
    return 'employee:${fields.assigneeEmployeeId}';
  }
  if (fields.assigneeUnresolved) return '';
  return 'unassigned';
}

List<AskChoice> projectOptions(AskDraft draft) {
  final fields = draft.fields;
  final options = [...fields.projectChoices];
  final id = fields.projectId;
  if (id == null || options.any((choice) => choice.id == id)) return options;
  final name = fields.projectName;
  return [
    AskChoice(id: id, label: name == null || name.isEmpty ? id : name),
    ...options,
  ];
}

List<AskChoice> assigneeOptions(AskDraft draft) {
  final fields = draft.fields;
  final options = [...fields.assigneeChoices];
  void ensure(String? id, String? name, String kind) {
    if (id == null || id.isEmpty) return;
    final exists = options.any(
      (choice) => choice.id == id && (choice.kind ?? 'user') == kind,
    );
    if (exists) return;
    options.insert(
      0,
      AskChoice(
        id: id,
        label: name == null || name.isEmpty ? id : name,
        kind: kind,
      ),
    );
  }

  ensure(fields.assigneeId, fields.assigneeName, 'user');
  ensure(fields.assigneeEmployeeId, fields.assigneeName, 'employee');
  return options;
}

bool emailOk(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) return true;
  return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(trimmed);
}

bool taskReady({
  required String title,
  required String projectId,
  required String assignee,
}) {
  final trimmed = title.trim();
  return trimmed.isNotEmpty &&
      trimmed.length <= 300 &&
      projectId.isNotEmpty &&
      assignee.isNotEmpty;
}

bool leadReady({required String name, required String email}) {
  final trimmed = name.trim();
  return trimmed.isNotEmpty && trimmed.length <= 200 && emailOk(email);
}

Map<String, String> splitAssignee(String value) {
  if (value.isEmpty || value == 'unassigned') return {};
  final colon = value.indexOf(':');
  if (colon < 0) return {};
  final kind = value.substring(0, colon);
  final id = value.substring(colon + 1);
  if (id.isEmpty) return {};
  if (kind == 'employee') return {'assigneeEmployeeId': id};
  if (kind == 'user') return {'assigneeId': id};
  return {};
}

/// The body for POST /project-tasks. An unassigned task sends no assignee.
Map<String, Object?> taskPayload({
  required String title,
  required String description,
  required String projectId,
  required String assignee,
  required String dueDate,
  required String priority,
}) => {
  'projectId': projectId,
  'title': title.trim(),
  if (description.trim().isNotEmpty) 'description': description.trim(),
  if (dueDate.isNotEmpty) 'dueDate': dueDate,
  'priority': priority,
  ...splitAssignee(assignee),
};

/// The body for POST /crm/leads. The owner is whoever saves; no assignee is sent.
Map<String, Object?> leadPayload({
  required String name,
  required String mobile,
  required String email,
  required String remarks,
}) => {
  'name': name.trim(),
  if (mobile.trim().isNotEmpty) 'mobile': mobile.trim(),
  if (email.trim().isNotEmpty) 'email': email.trim(),
  if (remarks.trim().isNotEmpty) 'remarks': remarks.trim(),
};

String? _text(Object? value) {
  if (value is! String) return null;
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

String? _date(Object? value) {
  final text = _text(value);
  if (text == null) return null;
  return RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(text) ? text : null;
}

String? _priority(Object? value) {
  final text = _text(value)?.toUpperCase();
  return text != null && askPriorities.contains(text) ? text : null;
}

List<String> _strings(Object? value) {
  if (value is! List) return const [];
  return [
    for (final item in value)
      if (item is String && item.trim().isNotEmpty) item.trim(),
  ];
}

List<AskChoice> _choices(Object? value) {
  if (value is! List) return const [];
  final choices = <AskChoice>[];
  for (final item in value) {
    if (item is! Map) continue;
    final id = _text(item['id']);
    final label = _text(item['label']);
    if (id == null || label == null) continue;
    final kind = item['kind'];
    choices.add(
      AskChoice(
        id: id,
        label: label,
        detail: _text(item['detail']),
        kind: kind == 'user' || kind == 'employee' ? kind as String : null,
      ),
    );
  }
  return choices;
}
