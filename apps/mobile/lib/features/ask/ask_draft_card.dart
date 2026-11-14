import 'package:flutter/material.dart';

import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'ask_copy.dart';
import 'ask_draft.dart';

/// The confirmation card under an assistant reply.
///
/// Save is the only write, and it uses the signed-in person's own request.
/// Cancel throws the card away. Nothing is queued: while the phone is offline
/// the fields stay editable and Save stays off.
class AskDraftCard extends StatefulWidget {
  const AskDraftCard({
    super.key,
    required this.draft,
    required this.bangla,
    required this.online,
    required this.onSave,
    this.onOpen,
  });

  final AskDraft draft;
  final bool bangla;
  final bool online;

  /// Returns the created id, when the endpoint sent one.
  final Future<String?> Function(Map<String, Object?> body) onSave;

  /// Opens a saved lead. Tasks have no screen on the phone, so this stays null.
  final void Function(String id)? onOpen;

  @override
  State<AskDraftCard> createState() => _AskDraftCardState();
}

class _AskDraftCardState extends State<AskDraftCard> {
  late final TextEditingController _title;
  late final TextEditingController _description;
  late final TextEditingController _due;
  late final TextEditingController _name;
  late final TextEditingController _mobile;
  late final TextEditingController _email;
  late final TextEditingController _remarks;
  late String _projectId;
  late String _assignee;
  late String _priority;
  bool _busy = false;
  bool _cancelled = false;
  bool _saved = false;
  String? _savedId;
  String? _error;

  AskCopy get _copy => AskCopy(widget.bangla);

  @override
  void initState() {
    super.initState();
    final fields = widget.draft.fields;
    _title = TextEditingController(text: fields.title ?? '');
    _description = TextEditingController(text: fields.description ?? '');
    _due = TextEditingController(text: fields.dueDate ?? '');
    _name = TextEditingController(text: fields.name ?? '');
    _mobile = TextEditingController(text: fields.mobile ?? '');
    _email = TextEditingController(text: fields.email ?? '');
    _remarks = TextEditingController(text: fields.remarks ?? '');
    _projectId = fields.projectId ?? '';
    _assignee = assigneeValueOf(widget.draft);
    _priority = initialPriority(widget.draft);
    for (final controller in [
      _title,
      _description,
      _due,
      _name,
      _mobile,
      _email,
      _remarks,
    ]) {
      controller.addListener(_refresh);
    }
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    for (final controller in [
      _title,
      _description,
      _due,
      _name,
      _mobile,
      _email,
      _remarks,
    ]) {
      controller
        ..removeListener(_refresh)
        ..dispose();
    }
    super.dispose();
  }

  bool get _ready => widget.draft.kind == AskDraftKind.task
      ? taskReady(
          title: _title.text,
          projectId: _projectId,
          assignee: _assignee,
        )
      : leadReady(name: _name.text, email: _email.text);

  bool get _canSave => _ready && widget.online && !_busy;

  Map<String, Object?> _body() => widget.draft.kind == AskDraftKind.task
      ? taskPayload(
          title: _title.text,
          description: _description.text,
          projectId: _projectId,
          assignee: _assignee,
          dueDate: _due.text.trim(),
          priority: _priority,
        )
      : leadPayload(
          name: _name.text,
          mobile: _mobile.text,
          email: _email.text,
          remarks: _remarks.text,
        );

  Future<void> _save() async {
    if (!_canSave) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final id = await widget.onSave(_body());
      if (!mounted) return;
      setState(() {
        _busy = false;
        _saved = true;
        _savedId = id;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = describeError(error);
      });
    }
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final parsed = DateTime.tryParse(_due.text);
    final initial = parsed ?? now;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 5),
    );
    if (picked == null || !mounted) return;
    final month = picked.month.toString().padLeft(2, '0');
    final day = picked.day.toString().padLeft(2, '0');
    setState(() => _due.text = '${picked.year}-$month-$day');
  }

  @override
  Widget build(BuildContext context) {
    if (_cancelled) return const SizedBox.shrink();
    final copy = _copy;
    final task = widget.draft.kind == AskDraftKind.task;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: _saved ? _savedView(copy, task) : _form(copy, task),
      ),
    );
  }

  Widget _savedView(AskCopy copy, bool task) {
    final id = _savedId;
    final open = widget.onOpen;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          task ? copy.savedTask : copy.savedLead,
          style: const TextStyle(fontSize: 14),
        ),
        if (!task && open != null && id != null && id.isNotEmpty)
          TextButton(
            style: TextButton.styleFrom(
              padding: EdgeInsets.zero,
              minimumSize: const Size(0, kTouchTarget),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            onPressed: () => open(id),
            child: Text(copy.openLead),
          ),
      ],
    );
  }

  Widget _form(AskCopy copy, bool task) {
    final projects = projectOptions(widget.draft);
    final emailBad = !emailOk(_email.text);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          task ? copy.taskTitle : copy.leadTitle,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 2),
        Text(
          copy.review,
          style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
        ),
        for (final warning in widget.draft.warnings) ...[
          const SizedBox(height: 4),
          Text(
            warning,
            style: const TextStyle(fontSize: 12, color: AppColors.warningText),
          ),
        ],
        if (task) ...[
          _Field(
            label: copy.title,
            required: _title.text.trim().isEmpty,
            child: _box(
              controller: _title,
              maxLength: 300,
              textCapitalization: TextCapitalization.sentences,
            ),
          ),
          _Field(
            label: copy.description,
            child: _box(
              controller: _description,
              maxLength: 5000,
              maxLines: 3,
              textCapitalization: TextCapitalization.sentences,
            ),
          ),
          _Field(
            label: copy.project,
            required: _projectId.isEmpty,
            child: projects.isEmpty && _projectId.isEmpty
                ? Text(
                    copy.noProjects,
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppColors.danger,
                    ),
                  )
                : _menu<String>(
                    value: _projectId.isEmpty ? null : _projectId,
                    hint: copy.projectPlaceholder,
                    onChanged: (value) =>
                        setState(() => _projectId = value ?? ''),
                    items: [
                      for (final choice in projects)
                        DropdownMenuItem(
                          value: choice.id,
                          child: Text(
                            choice.menuLabel,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                  ),
          ),
          _Field(
            label: copy.assignee,
            required: _assignee.isEmpty,
            child: _menu<String>(
              value: _assignee.isEmpty ? null : _assignee,
              hint: copy.chooseAssignee,
              onChanged: (value) => setState(() => _assignee = value ?? ''),
              items: [
                DropdownMenuItem(
                  value: 'unassigned',
                  child: Text(copy.unassigned),
                ),
                for (final choice in assigneeOptions(widget.draft))
                  DropdownMenuItem(
                    value: choice.value,
                    child: Text(
                      choice.menuLabel,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
            ),
          ),
          _Field(
            label: copy.dueDate,
            child: TextField(
              controller: _due,
              readOnly: true,
              onTap: _busy ? null : _pickDate,
              decoration: InputDecoration(
                isDense: true,
                hintText: copy.dueDate,
                suffixIcon: _due.text.isEmpty
                    ? const Icon(Icons.calendar_today_outlined, size: 18)
                    : IconButton(
                        tooltip: copy.clearDate,
                        onPressed: () => setState(() => _due.clear()),
                        icon: const Icon(Icons.close, size: 18),
                      ),
              ),
            ),
          ),
          _Field(
            label: copy.priority,
            child: _menu<String>(
              value: _priority,
              onChanged: (value) =>
                  setState(() => _priority = value ?? 'MEDIUM'),
              items: [
                for (final code in askPriorities)
                  DropdownMenuItem(
                    value: code,
                    child: Text(copy.priorityLabel(code)),
                  ),
              ],
            ),
          ),
        ] else ...[
          _Field(
            label: copy.name,
            required: _name.text.trim().isEmpty,
            child: _box(
              controller: _name,
              maxLength: 200,
              textCapitalization: TextCapitalization.words,
            ),
          ),
          _Field(
            label: copy.phone,
            child: _box(
              controller: _mobile,
              maxLength: 40,
              keyboardType: TextInputType.phone,
            ),
          ),
          _Field(
            label: copy.email,
            required: emailBad,
            child: _box(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              errorText: emailBad ? copy.emailInvalid : null,
            ),
          ),
          _Field(
            label: copy.note,
            child: _box(
              controller: _remarks,
              maxLength: 5000,
              maxLines: 3,
              textCapitalization: TextCapitalization.sentences,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            copy.companyHint,
            style: const TextStyle(
              fontSize: 11,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 4),
          Text.rich(
            TextSpan(
              style: const TextStyle(fontSize: 13, color: AppColors.label),
              children: [
                TextSpan(text: '${copy.owner}: '),
                TextSpan(
                  text: copy.ownerYou,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    color: AppColors.text,
                  ),
                ),
              ],
            ),
          ),
        ],
        if (!widget.online) ...[
          const SizedBox(height: 8),
          InlineNotice(message: copy.offline),
        ],
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(
            _error!,
            style: const TextStyle(fontSize: 12, color: AppColors.danger),
          ),
        ],
        const SizedBox(height: 8),
        Row(
          children: [
            FilledButton(
              onPressed: _canSave ? _save : null,
              child: Text(_busy ? copy.saving : copy.save),
            ),
            const SizedBox(width: 8),
            OutlinedButton(
              onPressed: _busy ? null : () => setState(() => _cancelled = true),
              child: Text(copy.cancel),
            ),
          ],
        ),
      ],
    );
  }

  Widget _box({
    required TextEditingController controller,
    int? maxLength,
    int maxLines = 1,
    TextInputType? keyboardType,
    TextCapitalization textCapitalization = TextCapitalization.none,
    String? errorText,
  }) {
    return TextField(
      controller: controller,
      enabled: !_busy,
      maxLength: maxLength,
      maxLines: maxLines,
      keyboardType: keyboardType,
      textCapitalization: textCapitalization,
      buildCounter:
          (_, {required currentLength, required isFocused, maxLength}) => null,
      decoration: InputDecoration(isDense: true, errorText: errorText),
    );
  }

  Widget _menu<T>({
    required T? value,
    required List<DropdownMenuItem<T>> items,
    required ValueChanged<T?> onChanged,
    String? hint,
  }) {
    return DropdownButtonFormField<T>(
      initialValue: value,
      isExpanded: true,
      menuMaxHeight: 280,
      hint: hint == null ? null : Text(hint),
      decoration: const InputDecoration(isDense: true),
      items: items,
      onChanged: _busy ? null : onChanged,
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.label,
    required this.child,
    this.required = false,
  });

  final String label;
  final bool required;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text.rich(
            TextSpan(
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.label,
              ),
              children: [
                TextSpan(text: label),
                if (required)
                  const TextSpan(
                    text: ' *',
                    style: TextStyle(color: AppColors.danger),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          child,
        ],
      ),
    );
  }
}
