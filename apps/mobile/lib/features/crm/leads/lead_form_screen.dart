import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api_exception.dart';
import '../../../ui/widgets.dart';
import '../activities/activity_sheets.dart' show DueTimePicker;
import '../data/crm_providers.dart';
import '../data/crm_repository.dart';
import '../data/models.dart';
import '../widgets/crm_widgets.dart';

/// Creates a lead, or edits one when [leadId] is given.
class LeadFormScreen extends ConsumerWidget {
  const LeadFormScreen({super.key, this.leadId});

  final String? leadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = leadId;
    if (id == null) return const _LeadForm();
    return ref
        .watch(leadProvider(id))
        .when(
          loading: () => const Scaffold(body: LoadingView()),
          error: (error, _) => Scaffold(
            appBar: AppBar(title: const Text('Edit lead')),
            body: ErrorView(
              message: describeError(error),
              onRetry: () => ref.invalidate(leadProvider(id)),
            ),
          ),
          data: (lead) => _LeadForm(original: lead),
        );
  }
}

class _LeadForm extends ConsumerStatefulWidget {
  const _LeadForm({this.original});

  /// The lead being edited; null when creating.
  final Lead? original;

  @override
  ConsumerState<_LeadForm> createState() => _LeadFormState();
}

class _LeadFormState extends ConsumerState<_LeadForm> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.original?.name);
  late final _mobile = TextEditingController(text: widget.original?.mobile);
  late final _email = TextEditingController(text: widget.original?.email);
  late final _address = TextEditingController(text: widget.original?.address);
  late final _remarks = TextEditingController(text: widget.original?.remarks);
  final _nextStep = TextEditingController();
  late String? _sourceId = widget.original?.source?.id;
  late String? _categoryId = widget.original?.category?.id;
  late LeadPriority _priority =
      widget.original?.priority ?? LeadPriority.medium;
  DateTime? _nextStepAt;
  bool _saving = false;

  /// Server refusals that belong to one field, shown under it.
  String? _mobileError;
  String? _emailError;
  String? _error;

  bool get _editing => widget.original != null;

  @override
  void dispose() {
    for (final controller in [
      _name,
      _mobile,
      _email,
      _address,
      _remarks,
      _nextStep,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Map<String, Object?> _createFields() => {
    'name': _name.text.trim(),
    'mobile': _mobile.text.trim(),
    'email': _email.text.trim(),
    'address': _address.text.trim(),
    'source': _sourceId,
    'category': _categoryId,
    'priority': _priority.code,
    'remarks': _remarks.text.trim(),
    'next_step': _nextStep.text.trim(),
    if (_nextStep.text.trim().isNotEmpty && _nextStepAt != null)
      'next_step_date': wallClockIso(_nextStepAt!),
  };

  /// Only what changed. A cleared field goes as `null`, which is what clears
  /// it on this endpoint (`''` would store an empty string instead).
  Map<String, Object?> _changes(Lead lead) {
    Object? text(TextEditingController c) =>
        c.text.trim().isEmpty ? null : c.text.trim();
    return {
      if (_name.text.trim() != lead.name) 'name': _name.text.trim(),
      if (text(_mobile) != lead.mobile) 'mobile': text(_mobile),
      if (text(_email) != null && text(_email) != lead.email)
        'email': text(_email),
      if (text(_address) != lead.address) 'address': text(_address),
      if (text(_remarks) != lead.remarks) 'remarks': text(_remarks),
      if (_sourceId != null && _sourceId != lead.source?.id)
        'source': _sourceId,
      if (_categoryId != lead.category?.id) 'category': _categoryId ?? '',
      if (_priority != lead.priority) 'priority': _priority.code,
    };
  }

  Future<void> _save() async {
    setState(() {
      _mobileError = null;
      _emailError = null;
      _error = null;
    });
    if (!_form.currentState!.validate()) return;

    final repo = ref.read(crmRepositoryProvider);
    final original = widget.original;
    setState(() => _saving = true);
    try {
      if (original == null) {
        final lead = await repo.createLead(_createFields());
        ref.refreshLeadViews();
        showToast('Lead added', tone: Tone.success);
        if (mounted) context.go('/leads/${lead.id}');
      } else {
        final changes = _changes(original);
        if (changes.isNotEmpty) {
          await repo.updateLead(original.id, changes);
          ref.refreshLeadViews(original.id);
          showToast('Lead updated', tone: Tone.success);
        }
        if (mounted) context.pop();
      }
    } on ApiException catch (e) {
      setState(() {
        // "A lead with this mobile number already exists." and friends.
        final message = e.message.toLowerCase();
        if (message.contains('mobile')) {
          _mobileError = e.message;
        } else if (message.contains('email')) {
          _emailError = e.message;
        } else {
          _error = e.message;
        }
      });
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final sources =
        ref.watch(taxonomyProvider(TaxonomyKind.sources)).value ?? const [];
    final categories =
        ref.watch(taxonomyProvider(TaxonomyKind.categories)).value ?? const [];

    return Scaffold(
      appBar: AppBar(
        title: Text(_editing ? 'Edit lead' : 'New lead'),
        actions: [
          TextButton(
            onPressed: _saving ? null : _save,
            child: _saving
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Save'),
          ),
        ],
      ),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_error != null) ...[
              InlineNotice(message: _error!, tone: Tone.danger),
              const SizedBox(height: 16),
            ],
            TextFormField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.next,
              decoration: const InputDecoration(labelText: 'Name *'),
              validator: (value) =>
                  (value ?? '').trim().isEmpty ? 'Enter a name.' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _mobile,
              keyboardType: TextInputType.phone,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(
                labelText: 'Mobile',
                hintText: '01XXXXXXXXX',
                errorText: _mobileError,
                errorMaxLines: 2,
              ),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(
                labelText: 'Email',
                errorText: _emailError,
                errorMaxLines: 2,
              ),
              validator: (value) {
                final email = (value ?? '').trim();
                if (email.isEmpty) {
                  // The API ignores an empty email on update, so a saved one
                  // cannot be removed — say so rather than silently keep it.
                  return widget.original?.email != null
                      ? "A saved email can be changed but not removed."
                      : null;
                }
                return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)
                    ? null
                    : "That email address doesn't look right.";
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _address,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Address'),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              // Rebuilt once the list arrives, to show the saved choice.
              key: ValueKey('source-${sources.length}'),
              initialValue: sources.any((s) => s.id == _sourceId)
                  ? _sourceId
                  : null,
              decoration: const InputDecoration(
                labelText: 'Source',
                helperText:
                    'Where the lead came from. Left empty, it counts as Other.',
              ),
              items: [
                for (final source in sources)
                  DropdownMenuItem(value: source.id, child: Text(source.name)),
              ],
              onChanged: (id) => setState(() => _sourceId = id),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              key: ValueKey('category-${categories.length}'),
              initialValue: categories.any((c) => c.id == _categoryId)
                  ? _categoryId
                  : null,
              decoration: const InputDecoration(labelText: 'Category'),
              items: [
                const DropdownMenuItem<String?>(
                  value: null,
                  child: Text('None'),
                ),
                for (final category in categories)
                  DropdownMenuItem(
                    value: category.id,
                    child: Text(category.name),
                  ),
              ],
              onChanged: (id) => setState(() => _categoryId = id),
            ),
            const SizedBox(height: 16),
            Text('Priority', style: Theme.of(context).textTheme.labelMedium),
            const SizedBox(height: 6),
            SegmentedButton<LeadPriority>(
              showSelectedIcon: false,
              segments: [
                for (final priority in LeadPriority.values)
                  ButtonSegment(value: priority, label: Text(priority.label)),
              ],
              selected: {_priority},
              onSelectionChanged: (value) =>
                  setState(() => _priority = value.first),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _remarks,
              minLines: 2,
              maxLines: 5,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Remarks'),
            ),
            if (!_editing) ...[
              const SizedBox(height: 24),
              Text(
                'First follow-up',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 4),
              Text(
                'Optional. Plans the first thing to do, assigned to you.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _nextStep,
                textCapitalization: TextCapitalization.sentences,
                decoration: const InputDecoration(
                  labelText: 'What needs doing?',
                  hintText: 'e.g. Call back with prices',
                ),
                onChanged: (_) => setState(() {}),
              ),
              if (_nextStep.text.trim().isNotEmpty) ...[
                const SizedBox(height: 12),
                DueTimePicker(
                  value: _nextStepAt,
                  onChanged: (value) => setState(() => _nextStepAt = value),
                ),
              ],
            ],
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}
