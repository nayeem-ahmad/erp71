import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api_exception.dart';
import '../../../core/format/format.dart';
import '../../../ui/launch.dart';
import '../../../ui/theme.dart';
import '../../../ui/widgets.dart';
import '../access.dart';
import '../data/crm_providers.dart';
import '../data/crm_repository.dart';
import '../data/models.dart';
import '../widgets/crm_widgets.dart';

// The sheets that record work against a lead: log something that happened,
// plan the next follow-up, and close out a planned one.

/// Records a call, visit or message that already happened.
Future<void> showLogActivitySheet(
  BuildContext context, {
  required String leadId,
}) => showAppSheet<void>(
  context: context,
  title: 'Log activity',
  builder: (_) => _LogActivityForm(leadId: leadId),
);

/// Schedules the next thing to do with a lead.
Future<void> showPlanFollowUpSheet(
  BuildContext context, {
  required String leadId,
}) => showAppSheet<void>(
  context: context,
  title: 'Plan a follow-up',
  builder: (_) => _PlanFollowUpForm(leadId: leadId),
);

/// Marks a planned activity done and, optionally, plans the next one.
Future<void> showCompleteActivitySheet(
  BuildContext context,
  Activity activity,
) => showAppSheet<void>(
  context: context,
  title: 'Mark as done',
  builder: (_) => _CompleteActivityForm(activity: activity),
);

/// What the details sheet hands back to do once it has closed — work that
/// needs the caller's context, since the sheet's own is gone by then.
enum _Then { complete, openLead }

/// An activity's details, with what can be done to it.
Future<void> showActivitySheet(
  BuildContext context,
  Activity activity, {
  bool showLeadLink = true,
}) async {
  final then = await showAppSheet<_Then>(
    context: context,
    title: activity.title,
    builder: (_) =>
        _ActivityDetails(activity: activity, showLeadLink: showLeadLink),
  );
  if (!context.mounted) return;
  switch (then) {
    case _Then.complete:
      await showCompleteActivitySheet(context, activity);
    case _Then.openLead:
      context.go('/leads/${activity.leadId}');
    case null:
      break;
  }
}

class _LogActivityForm extends ConsumerStatefulWidget {
  const _LogActivityForm({required this.leadId});

  final String leadId;

  @override
  ConsumerState<_LogActivityForm> createState() => _LogActivityFormState();
}

class _LogActivityFormState extends ConsumerState<_LogActivityForm> {
  final _summary = TextEditingController();
  final _outcome = TextEditingController();
  String? _channelId;
  bool _inbound = false;
  bool _saving = false;
  String? _summaryError;
  String? _channelError;
  String? _error;

  @override
  void dispose() {
    _summary.dispose();
    _outcome.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _channelError = _channelId == null
          ? 'Choose how you were in touch.'
          : null;
      _summaryError = _summary.text.trim().isEmpty
          ? 'Say briefly what happened.'
          : null;
      _error = null;
    });
    if (_channelError != null || _summaryError != null) return;

    setState(() => _saving = true);
    try {
      await ref
          .read(crmRepositoryProvider)
          .logActivity(
            leadId: widget.leadId,
            channelId: _channelId!,
            summary: _summary.text.trim(),
            outcome: _outcome.text.trim(),
            inbound: _inbound,
          );
      ref.refreshLeadViews(widget.leadId);
      if (mounted) Navigator.of(context).pop();
      showToast('Activity logged', tone: Tone.success);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _ChannelPicker(
          selected: _channelId,
          error: _channelError,
          onSelected: (id) => setState(() {
            _channelId = id;
            _channelError = null;
          }),
        ),
        const SizedBox(height: 12),
        SegmentedButton<bool>(
          segments: const [
            ButtonSegment(value: false, label: Text('We reached out')),
            ButtonSegment(value: true, label: Text('They reached out')),
          ],
          selected: {_inbound},
          onSelectionChanged: (value) => setState(() => _inbound = value.first),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _summary,
          minLines: 2,
          maxLines: 5,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            labelText: 'What happened? *',
            errorText: _summaryError,
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _outcome,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            labelText: 'Outcome',
            hintText: 'e.g. Interested, wants a quote',
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          InlineNotice(message: _error!, tone: Tone.danger),
        ],
        const SizedBox(height: 16),
        _SaveButton(label: 'Save', saving: _saving, onPressed: _save),
      ],
    );
  }
}

class _PlanFollowUpForm extends ConsumerStatefulWidget {
  const _PlanFollowUpForm({required this.leadId});

  final String leadId;

  @override
  ConsumerState<_PlanFollowUpForm> createState() => _PlanFollowUpFormState();
}

class _PlanFollowUpFormState extends ConsumerState<_PlanFollowUpForm> {
  final _subject = TextEditingController();
  final _notes = TextEditingController();
  DateTime? _dueAt;
  String? _purposeId;
  bool _saving = false;
  String? _subjectError;
  String? _dueError;
  String? _error;

  @override
  void dispose() {
    _subject.dispose();
    _notes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _subjectError = _subject.text.trim().isEmpty
          ? 'Say what needs doing.'
          : null;
      _dueError = _dueAt == null ? 'Choose when.' : null;
      _error = null;
    });
    if (_subjectError != null || _dueError != null) return;

    setState(() => _saving = true);
    try {
      await ref
          .read(crmRepositoryProvider)
          .planActivity(
            leadId: widget.leadId,
            subject: _subject.text.trim(),
            dueAt: _dueAt!,
            purposeId: _purposeId,
            notes: _notes.text.trim(),
          );
      ref.refreshLeadViews(widget.leadId);
      if (mounted) Navigator.of(context).pop();
      showToast('Follow-up planned', tone: Tone.success);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final purposes = ref.watch(taxonomyProvider(TaxonomyKind.purposes));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _subject,
          maxLength: 300,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            labelText: 'What needs doing? *',
            hintText: 'e.g. Call back about pricing',
            errorText: _subjectError,
            counterText: '',
          ),
        ),
        const SizedBox(height: 12),
        DueTimePicker(
          value: _dueAt,
          error: _dueError,
          onChanged: (value) => setState(() {
            _dueAt = value;
            _dueError = null;
          }),
        ),
        const SizedBox(height: 12),
        if (purposes.value case final options? when options.isNotEmpty) ...[
          DropdownButtonFormField<String>(
            initialValue: _purposeId,
            decoration: const InputDecoration(labelText: 'Purpose'),
            items: [
              for (final option in options)
                DropdownMenuItem(value: option.id, child: Text(option.label)),
            ],
            onChanged: (id) => setState(() => _purposeId = id),
          ),
          const SizedBox(height: 12),
        ],
        TextField(
          controller: _notes,
          minLines: 1,
          maxLines: 4,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(labelText: 'Notes'),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          InlineNotice(message: _error!, tone: Tone.danger),
        ],
        const SizedBox(height: 16),
        _SaveButton(label: 'Plan follow-up', saving: _saving, onPressed: _save),
      ],
    );
  }
}

class _CompleteActivityForm extends ConsumerStatefulWidget {
  const _CompleteActivityForm({required this.activity});

  final Activity activity;

  @override
  ConsumerState<_CompleteActivityForm> createState() =>
      _CompleteActivityFormState();
}

class _CompleteActivityFormState extends ConsumerState<_CompleteActivityForm> {
  final _summary = TextEditingController();
  final _outcome = TextEditingController();
  final _nextSubject = TextEditingController();
  String? _channelId;
  bool _planNext = false;
  DateTime? _nextDueAt;
  bool _saving = false;
  String? _channelError;
  String? _summaryError;
  String? _nextError;
  String? _error;

  @override
  void dispose() {
    _summary.dispose();
    _outcome.dispose();
    _nextSubject.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() {
      _channelError = _channelId == null
          ? 'Choose how you were in touch.'
          : null;
      _summaryError = _summary.text.trim().isEmpty
          ? 'Say briefly what happened.'
          : null;
      _nextError =
          _planNext && (_nextSubject.text.trim().isEmpty || _nextDueAt == null)
          ? 'Give the next follow-up a title and a time, or switch it off.'
          : null;
      _error = null;
    });
    if (_channelError != null || _summaryError != null || _nextError != null) {
      return;
    }

    setState(() => _saving = true);
    try {
      await ref
          .read(crmRepositoryProvider)
          .completeActivity(
            widget.activity.id,
            channelId: _channelId!,
            summary: _summary.text.trim(),
            outcome: _outcome.text.trim(),
            nextSubject: _planNext ? _nextSubject.text.trim() : null,
            nextDueAt: _planNext ? _nextDueAt : null,
          );
      ref.refreshLeadViews(widget.activity.leadId);
      if (mounted) Navigator.of(context).pop();
      showToast(
        _planNext ? 'Done, next follow-up planned' : 'Marked as done',
        tone: Tone.success,
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.activity.targetName != null) ...[
          Text(
            widget.activity.targetName!,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
        ],
        _ChannelPicker(
          selected: _channelId,
          error: _channelError,
          onSelected: (id) => setState(() {
            _channelId = id;
            _channelError = null;
          }),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _summary,
          minLines: 2,
          maxLines: 5,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            labelText: 'What happened? *',
            errorText: _summaryError,
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _outcome,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(labelText: 'Outcome'),
        ),
        const SizedBox(height: 4),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          tileColor: Colors.transparent,
          title: const Text('Plan the next follow-up'),
          value: _planNext,
          onChanged: (value) => setState(() {
            _planNext = value;
            _nextError = null;
          }),
        ),
        if (_planNext) ...[
          TextField(
            controller: _nextSubject,
            maxLength: 300,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: 'Next follow-up',
              hintText: 'e.g. Send the quotation',
              counterText: '',
            ),
          ),
          const SizedBox(height: 12),
          DueTimePicker(
            value: _nextDueAt,
            onChanged: (value) => setState(() => _nextDueAt = value),
          ),
          if (_nextError != null) ...[
            const SizedBox(height: 8),
            Text(
              _nextError!,
              style: const TextStyle(fontSize: 12, color: AppColors.danger),
            ),
          ],
        ],
        if (_error != null) ...[
          const SizedBox(height: 12),
          InlineNotice(message: _error!, tone: Tone.danger),
        ],
        const SizedBox(height: 16),
        _SaveButton(label: 'Mark as done', saving: _saving, onPressed: _save),
      ],
    );
  }
}

class _ActivityDetails extends ConsumerStatefulWidget {
  const _ActivityDetails({required this.activity, required this.showLeadLink});

  final Activity activity;
  final bool showLeadLink;

  @override
  ConsumerState<_ActivityDetails> createState() => _ActivityDetailsState();
}

class _ActivityDetailsState extends ConsumerState<_ActivityDetails> {
  bool _busy = false;

  Activity get _activity => widget.activity;

  Future<void> _reschedule() async {
    final initial = _activity.dueAt == null
        ? workspaceNow()
        : inWorkspaceZone(_activity.dueAt!);
    final picked = await pickDateTime(context, initial);
    if (picked == null || !mounted) return;
    await _run(
      () => ref
          .read(crmRepositoryProvider)
          .rescheduleActivity(_activity.id, picked),
      done: 'Rescheduled to ${formatWallClock(picked)}',
    );
  }

  Future<void> _cancel() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel this activity?'),
        content: const Text('It stays on the timeline, marked cancelled.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep it'),
          ),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Cancel activity'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _run(
      () => ref.read(crmRepositoryProvider).cancelActivity(_activity.id),
      done: 'Activity cancelled',
    );
  }

  Future<void> _run(
    Future<Object?> Function() action, {
    required String done,
  }) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.refreshLeadViews(_activity.leadId);
      if (mounted) Navigator.of(context).pop();
      showToast(done, tone: Tone.success);
    } on ApiException catch (e) {
      showToast(e.message, tone: Tone.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = _activity;
    final canComplete = ref.can(CrmPermission.completeActivities);
    final canManage = ref.can(CrmPermission.manageActivities);
    final when = switch (a.status) {
      ActivityStatus.planned =>
        a.dueAt == null ? 'No due date' : formatDueLabel(a.dueAt),
      ActivityStatus.done => formatDateTime(a.completedAt),
      ActivityStatus.cancelled => 'Cancelled',
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            StatusBadge(
              a.status.label,
              tone: switch (a.status) {
                ActivityStatus.done => Tone.success,
                ActivityStatus.cancelled => Tone.neutral,
                ActivityStatus.planned when a.isOverdue() => Tone.danger,
                ActivityStatus.planned => Tone.primary,
              },
            ),
            const SizedBox(width: 8),
            Text(when, style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
        const SizedBox(height: 8),
        if (a.targetName != null) InfoRow(label: 'For', value: a.targetName!),
        if (a.purpose != null)
          InfoRow(label: 'Purpose', value: a.purpose!.label),
        if (a.channel != null)
          InfoRow(label: 'Channel', value: a.channel!.label),
        if (a.assignee != null)
          InfoRow(label: 'Assigned to', value: a.assignee!.displayName),
        if (a.subject != null && a.summary != null)
          InfoRow(label: 'What happened', value: a.summary!),
        if (a.outcome != null) InfoRow(label: 'Outcome', value: a.outcome!),
        if (a.notes != null) InfoRow(label: 'Notes', value: a.notes!),
        const SizedBox(height: 12),
        if (a.targetPhone != null)
          OutlinedButton.icon(
            onPressed: () => callNumber(a.targetPhone!),
            icon: const Icon(Icons.call_outlined, size: 18),
            label: Text('Call ${a.targetPhone}'),
          ),
        if (widget.showLeadLink && a.leadId != null) ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => Navigator.of(context).pop(_Then.openLead),
            icon: const Icon(Icons.person_outline, size: 18),
            label: const Text('Open lead'),
          ),
        ],
        if (a.isPlanned) ...[
          if (canComplete) ...[
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _busy
                  ? null
                  : () => Navigator.of(context).pop(_Then.complete),
              icon: const Icon(Icons.check, size: 18),
              label: const Text('Mark as done'),
            ),
          ],
          if (canManage) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _busy ? null : _reschedule,
                    child: const Text('Reschedule'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.danger,
                    ),
                    onPressed: _busy ? null : _cancel,
                    child: const Text('Cancel activity'),
                  ),
                ),
              ],
            ),
          ],
        ],
      ],
    );
  }
}

/// How the contact happened — the workspace's own channel list.
class _ChannelPicker extends ConsumerWidget {
  const _ChannelPicker({
    required this.selected,
    required this.onSelected,
    this.error,
  });

  final String? selected;
  final ValueChanged<String> onSelected;
  final String? error;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channels = ref.watch(taxonomyProvider(TaxonomyKind.channels));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Channel *', style: Theme.of(context).textTheme.labelMedium),
        const SizedBox(height: 6),
        channels.when(
          loading: () => const LinearProgressIndicator(),
          error: (e, _) => TextButton.icon(
            onPressed: () =>
                ref.invalidate(taxonomyProvider(TaxonomyKind.channels)),
            icon: const Icon(Icons.refresh, size: 18),
            label: Text(describeError(e)),
          ),
          data: (options) => Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final option in options)
                ChoiceChip(
                  label: Text(option.label),
                  selected: option.id == selected,
                  onSelected: (_) => onSelected(option.id),
                ),
            ],
          ),
        ),
        if (error != null) ...[
          const SizedBox(height: 6),
          Text(
            error!,
            style: const TextStyle(fontSize: 12, color: AppColors.danger),
          ),
        ],
      ],
    );
  }
}

/// Quick picks for when a follow-up is due, plus any date and time.
class DueTimePicker extends StatelessWidget {
  const DueTimePicker({
    super.key,
    required this.value,
    required this.onChanged,
    this.error,
  });

  final DateTime? value;
  final ValueChanged<DateTime> onChanged;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final now = workspaceNow();
    DateTime at(DateTime day, int hour) =>
        DateTime(day.year, day.month, day.day, hour);
    final choices = <(String, DateTime)>[
      (
        'In 1 hour',
        DateTime(now.year, now.month, now.day, now.hour + 1, now.minute),
      ),
      ('Tomorrow 10:00', at(now.add(const Duration(days: 1)), 10)),
      ('In 3 days', at(now.add(const Duration(days: 3)), 10)),
      ('Next week', at(now.add(const Duration(days: 7)), 10)),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('When *', style: Theme.of(context).textTheme.labelMedium),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final (label, time) in choices)
              ChoiceChip(
                label: Text(label),
                selected: value == time,
                onSelected: (_) => onChanged(time),
              ),
            ActionChip(
              avatar: const Icon(Icons.event, size: 18),
              label: Text(
                value == null || choices.any((c) => c.$2 == value)
                    ? 'Pick a time'
                    : formatWallClock(value!),
              ),
              onPressed: () async {
                final picked = await pickDateTime(context, value ?? now);
                if (picked != null) onChanged(picked);
              },
            ),
          ],
        ),
        if (value != null) ...[
          const SizedBox(height: 6),
          Text(
            formatWallClock(value!),
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
        if (error != null) ...[
          const SizedBox(height: 6),
          Text(
            error!,
            style: const TextStyle(fontSize: 12, color: AppColors.danger),
          ),
        ],
      ],
    );
  }
}

/// A date then a time, on the workspace's wall clock.
Future<DateTime?> pickDateTime(BuildContext context, DateTime initial) async {
  final today = workspaceNow();
  final date = await showDatePicker(
    context: context,
    initialDate: initial,
    firstDate: DateTime(today.year - 1),
    lastDate: DateTime(today.year + 5),
  );
  if (date == null || !context.mounted) return null;
  final time = await showTimePicker(
    context: context,
    initialTime: TimeOfDay(hour: initial.hour, minute: initial.minute),
  );
  if (time == null) return null;
  return DateTime(date.year, date.month, date.day, time.hour, time.minute);
}

class _SaveButton extends StatelessWidget {
  const _SaveButton({
    required this.label,
    required this.saving,
    required this.onPressed,
  });

  final String label;
  final bool saving;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: saving ? null : onPressed,
      child: saving
          ? const SizedBox.square(
              dimension: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Colors.white,
              ),
            )
          : Text(label),
    );
  }
}
