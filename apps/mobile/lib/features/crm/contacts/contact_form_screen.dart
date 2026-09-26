import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api_exception.dart';
import '../../../ui/widgets.dart';
import '../data/crm_providers.dart';
import '../data/models.dart';
import '../widgets/crm_widgets.dart';

/// Creates a contact, or edits one when [contactId] is given.
class ContactFormScreen extends ConsumerWidget {
  const ContactFormScreen({super.key, this.contactId});

  final String? contactId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = contactId;
    if (id == null) return const _ContactForm();
    return ref
        .watch(contactProvider(id))
        .when(
          loading: () => const Scaffold(body: LoadingView()),
          error: (error, _) => Scaffold(
            appBar: AppBar(title: const Text('Edit contact')),
            body: ErrorView(
              message: describeError(error),
              onRetry: () => ref.invalidate(contactProvider(id)),
            ),
          ),
          data: (contact) => _ContactForm(original: contact),
        );
  }
}

/// The contact fields, in form order: API name, label, keyboard.
const _fields = <(String, String, TextInputType)>[
  ('company', 'Company', TextInputType.text),
  ('designation', 'Designation', TextInputType.text),
  ('mobile', 'Mobile', TextInputType.phone),
  ('phone', 'Other phone', TextInputType.phone),
  ('email', 'Email', TextInputType.emailAddress),
  ('address', 'Address', TextInputType.streetAddress),
  ('website_url', 'Website', TextInputType.url),
  ('linkedin_url', 'LinkedIn', TextInputType.url),
];

class _ContactForm extends ConsumerStatefulWidget {
  const _ContactForm({this.original});

  final Contact? original;

  @override
  ConsumerState<_ContactForm> createState() => _ContactFormState();
}

class _ContactFormState extends ConsumerState<_ContactForm> {
  final _form = GlobalKey<FormState>();
  late final _name = TextEditingController(text: widget.original?.name);
  late final _notes = TextEditingController(text: widget.original?.notes);
  late final Map<String, TextEditingController> _controllers = {
    for (final (key, _, _) in _fields)
      key: TextEditingController(text: _originalValue(key)),
  };
  bool _saving = false;
  String? _mobileError;
  String? _error;

  bool get _editing => widget.original != null;

  String? _originalValue(String key) {
    final c = widget.original;
    if (c == null) return null;
    return switch (key) {
      'company' => c.company,
      'designation' => c.designation,
      'mobile' => c.mobile,
      'phone' => c.phone,
      'email' => c.email,
      'address' => c.address,
      'website_url' => c.websiteUrl,
      'linkedin_url' => c.linkedinUrl,
      _ => null,
    };
  }

  @override
  void dispose() {
    _name.dispose();
    _notes.dispose();
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Map<String, String?> get _values => {
    'name': _name.text.trim(),
    for (final entry in _controllers.entries)
      entry.key: entry.value.text.trim(),
    'notes': _notes.text.trim(),
  };

  Future<void> _save() async {
    setState(() {
      _mobileError = null;
      _error = null;
    });
    if (!_form.currentState!.validate()) return;

    final repo = ref.read(crmRepositoryProvider);
    final original = widget.original;
    setState(() => _saving = true);
    try {
      if (original == null) {
        final contact = await repo.createContact(_values);
        ref.refreshContactViews();
        showToast('Contact added', tone: Tone.success);
        if (mounted) context.go('/contacts/${contact.id}');
      } else {
        final changes = {
          for (final entry in _values.entries)
            if (entry.value != (_originalOf(entry.key) ?? ''))
              entry.key: entry.value,
        };
        if (changes.isNotEmpty) {
          await repo.updateContact(original.id, changes);
          ref.refreshContactViews(original.id);
          showToast('Contact updated', tone: Tone.success);
        }
        if (mounted) context.pop();
      }
    } on ApiException catch (e) {
      setState(() {
        if (e.message.toLowerCase().contains('mobile')) {
          _mobileError = e.message;
        } else {
          _error = e.message;
        }
      });
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String? _originalOf(String key) => switch (key) {
    'name' => widget.original?.name,
    'notes' => widget.original?.notes,
    _ => _originalValue(key),
  };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_editing ? 'Edit contact' : 'New contact'),
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
            for (final (key, label, keyboard) in _fields) ...[
              const SizedBox(height: 12),
              TextFormField(
                controller: _controllers[key],
                keyboardType: keyboard,
                textInputAction: TextInputAction.next,
                textCapitalization: keyboard == TextInputType.text
                    ? TextCapitalization.words
                    : TextCapitalization.none,
                decoration: InputDecoration(
                  labelText: label,
                  errorText: key == 'mobile' ? _mobileError : null,
                  errorMaxLines: 2,
                ),
                validator: key == 'email'
                    ? (value) {
                        final email = (value ?? '').trim();
                        if (email.isEmpty) return null;
                        return RegExp(
                              r'^[^@\s]+@[^@\s]+\.[^@\s]+$',
                            ).hasMatch(email)
                            ? null
                            : "That email address doesn't look right.";
                      }
                    : null,
              ),
            ],
            const SizedBox(height: 12),
            TextFormField(
              controller: _notes,
              minLines: 2,
              maxLines: 5,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Notes'),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}
