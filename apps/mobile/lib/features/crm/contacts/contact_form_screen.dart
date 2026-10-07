import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/api_exception.dart';
import '../../../ui/widgets.dart';
import '../data/crm_providers.dart';
import '../data/models.dart';
import 'card_photo.dart';

/// Creates a contact, or edits one when [contactId] is given.
class ContactFormScreen extends ConsumerWidget {
  const ContactFormScreen({super.key, this.contactId, this.scanOnOpen = false});

  final String? contactId;

  /// Opens the card scanner straight away (new contacts only).
  final bool scanOnOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final id = contactId;
    if (id == null) return _ContactForm(scanOnOpen: scanOnOpen);
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
  const _ContactForm({this.original, this.scanOnOpen = false});

  final Contact? original;
  final bool scanOnOpen;

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
  bool _scanning = false;

  /// The card the fields were read from; kept against the contact once saved.
  CardPhoto? _card;
  String? _mobileError;
  String? _error;

  bool get _editing => widget.original != null;

  @override
  void initState() {
    super.initState();
    if (widget.scanOnOpen && !_editing) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _scan();
      });
    }
  }

  Future<CardPhotoSource?> _chooseSource() =>
      showModalBottomSheet<CardPhotoSource>(
        context: context,
        showDragHandle: true,
        builder: (context) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.photo_camera_outlined),
                title: const Text('Take a photo'),
                onTap: () => Navigator.pop(context, CardPhotoSource.camera),
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined),
                title: const Text('Choose from gallery'),
                onTap: () => Navigator.pop(context, CardPhotoSource.gallery),
              ),
            ],
          ),
        ),
      );

  /// Photographs a card, has the server read it, and fills the form for the
  /// user to correct. Nothing is saved until they tap Save.
  Future<void> _scan() async {
    final source = await _chooseSource();
    if (source == null || !mounted) return;
    setState(() {
      _error = null;
      _scanning = true;
    });
    try {
      final photo = await ref.read(cardPhotoPickerProvider)(source);
      if (photo == null) return;
      final fields = await ref
          .read(crmRepositoryProvider)
          .scanBusinessCard(photo.dataUrl, photo.mimeType);
      if (!mounted) return;
      setState(() {
        _card = photo;
        for (final entry in fields.entries) {
          if (entry.key == 'name') {
            _name.text = entry.value;
          } else {
            _controllers[entry.key]?.text = entry.value;
          }
        }
      });
      showToast('Card read. Check the details, then save.', tone: Tone.success);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Could not open the camera or photo library.');
      }
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
  }

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
        final card = _card;
        final contact = await repo.createContact({
          ..._values,
          if (card != null) 'capture_source': 'BUSINESS_CARD',
        });
        ref.refreshContactViews();
        showToast('Contact added', tone: Tone.success);
        if (card != null) {
          // The contact is already saved; a failed upload must not undo that.
          try {
            await repo.addContactCardImage(
              contact.id,
              card.dataUrl,
              card.mimeType,
            );
          } on ApiException {
            showToast('Saved, but the card photo could not be kept.');
          }
        }
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
            if (!_editing) ...[
              OutlinedButton.icon(
                onPressed: _scanning || _saving ? null : _scan,
                icon: _scanning
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.document_scanner_outlined, size: 18),
                label: Text(
                  _scanning
                      ? 'Reading card…'
                      : _card == null
                      ? 'Scan business card'
                      : 'Scan a different card',
                ),
              ),
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
