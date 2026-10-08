import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/format/format.dart';
import '../../core/push/push_registrar.dart';
import '../../ui/widgets.dart';
import 'alert_settings_data.dart';

/// What reaches this phone: each kind of alert on or off, quiet hours, and —
/// for those who run the shop — the amounts that raise an alert. The Alerts
/// tab lists everything regardless.
class AlertSettingsScreen extends ConsumerWidget {
  const AlertSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final preferences = ref.watch(alertPreferencesProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: preferences.when(
        skipLoadingOnRefresh: true,
        loading: () => const LoadingView(),
        error: (error, _) => ErrorView(
          message: describeError(error),
          onRetry: () => ref.invalidate(alertPreferencesProvider),
        ),
        data: (p) => _Settings(preferences: p),
      ),
    );
  }
}

class _Settings extends ConsumerStatefulWidget {
  const _Settings({required this.preferences});

  final AlertPreferences preferences;

  @override
  ConsumerState<_Settings> createState() => _SettingsState();
}

class _SettingsState extends ConsumerState<_Settings> {
  late AlertPreferences _p = widget.preferences;
  bool _saving = false;

  Future<void> _save(Map<String, Object?> changes) async {
    setState(() => _saving = true);
    try {
      final saved = await ref
          .read(alertSettingsRepositoryProvider)
          .save(changes);
      if (mounted) setState(() => _p = saved);
    } catch (error) {
      showToast(describeError(error), tone: Tone.danger);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pickTime({required bool from}) async {
    final current = _parse(from ? _p.quietFrom : _p.quietTo);
    final picked = await showTimePicker(context: context, initialTime: current);
    if (picked == null) return;
    final value =
        '${picked.hour.toString().padLeft(2, '0')}:'
        '${picked.minute.toString().padLeft(2, '0')}';
    await _save({from ? 'quiet_from' : 'quiet_to': value});
  }

  static TimeOfDay _parse(String hhmm) {
    final parts = hhmm.split(':');
    return TimeOfDay(
      hour: int.tryParse(parts.first) ?? 0,
      minute: int.tryParse(parts.length > 1 ? parts[1] : '0') ?? 0,
    );
  }

  @override
  Widget build(BuildContext context) {
    final workspace = ref.watch(activeWorkspaceProvider);
    final canSetLines = workspace?.can('MANAGE_USERS') ?? false;
    final status = ref.watch(pushRegistrarProvider);

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        if (status != PushStatus.registered) ...[
          InlineNotice(
            tone: Tone.neutral,
            message: switch (status) {
              PushStatus.declined =>
                'Notifications are off for ERP71 in this phone’s settings. '
                    'Alerts still collect in the Alerts tab.',
              PushStatus.unavailable =>
                'Push notifications are not set up for this workspace yet. '
                    'Alerts still collect in the Alerts tab.',
              _ =>
                'This phone is not receiving push notifications right now. '
                    'Alerts still collect in the Alerts tab.',
            },
          ),
          const SizedBox(height: 12),
        ],
        SectionCard(
          title: 'Send to this phone',
          padding: const EdgeInsets.fromLTRB(16, 16, 8, 8),
          child: Column(
            children: [
              for (final type in _p.types)
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  tileColor: Colors.transparent,
                  title: Text(type.label),
                  subtitle: Text(type.description),
                  value: !_p.muted.contains(type.type),
                  onChanged: _saving
                      ? null
                      : (on) => _save({
                          'muted_types': on
                              ? (_p.muted.difference({type.type})).toList()
                              : [..._p.muted, type.type],
                        }),
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        SectionCard(
          title: 'Quiet hours',
          padding: const EdgeInsets.fromLTRB(16, 16, 8, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                tileColor: Colors.transparent,
                title: const Text('Hold alerts at night'),
                subtitle: const Text(
                  'Anything that comes in arrives as one summary when quiet '
                  'hours end.',
                ),
                value: _p.quietEnabled,
                onChanged: _saving
                    ? null
                    : (on) => _save({'quiet_enabled': on}),
              ),
              if (_p.quietEnabled) ...[
                InfoRow(
                  label: 'From',
                  value: _p.quietFrom,
                  icon: Icons.schedule,
                  onTap: _saving ? null : () => _pickTime(from: true),
                ),
                InfoRow(
                  label: 'Until',
                  value: _p.quietTo,
                  icon: Icons.schedule,
                  onTap: _saving ? null : () => _pickTime(from: false),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 12),
        _ShopLines(
          preferences: _p,
          editable: canSetLines,
          onSaved: (saved) => setState(() => _p = saved),
        ),
        const SizedBox(height: 24),
      ],
    );
  }
}

/// The amounts at which the shop's managers hear about a sale, a refund or a
/// short till. Shown to everyone, changed by those who manage users.
class _ShopLines extends ConsumerStatefulWidget {
  const _ShopLines({
    required this.preferences,
    required this.editable,
    required this.onSaved,
  });

  final AlertPreferences preferences;
  final bool editable;
  final ValueChanged<AlertPreferences> onSaved;

  @override
  ConsumerState<_ShopLines> createState() => _ShopLinesState();
}

class _ShopLinesState extends ConsumerState<_ShopLines> {
  late final _sale = TextEditingController(
    text: widget.preferences.largeSale.toStringAsFixed(0),
  );
  late final _refund = TextEditingController(
    text: widget.preferences.largeRefund.toStringAsFixed(0),
  );
  late final _short = TextEditingController(
    text: widget.preferences.tillShortfall.toStringAsFixed(0),
  );
  final Map<String, String?> _errors = {};
  bool _saving = false;

  @override
  void dispose() {
    _sale.dispose();
    _refund.dispose();
    _short.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final values = <String, num>{};
    _errors.clear();
    for (final (key, controller) in [
      ('large_sale_amount', _sale),
      ('large_refund_amount', _refund),
      ('till_shortfall_amount', _short),
    ]) {
      final value = num.tryParse(controller.text.trim());
      if (value == null || value < 1) {
        _errors[key] = 'Enter an amount of at least ৳ 1';
      } else {
        values[key] = value;
      }
    }
    if (_errors.isNotEmpty) {
      setState(() {});
      return;
    }
    setState(() => _saving = true);
    try {
      final saved = await ref
          .read(alertSettingsRepositoryProvider)
          .saveThresholds(values);
      widget.onSaved(saved);
      showToast('Alert amounts saved', tone: Tone.success);
    } catch (error) {
      showToast(describeError(error), tone: Tone.danger);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _field(String key, String label, TextEditingController controller) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextField(
          controller: controller,
          enabled: widget.editable && !_saving,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: InputDecoration(
            labelText: label,
            prefixText: '৳ ',
            errorText: _errors[key],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final p = widget.preferences;
    if (!widget.editable) {
      return SectionCard(
        title: 'When the shop raises an alert',
        child: Column(
          children: [
            InfoRow(
              label: 'Sale of',
              value: '${formatBDT(p.largeSale)} or more',
            ),
            InfoRow(
              label: 'Refund of',
              value: '${formatBDT(p.largeRefund)} or more',
            ),
            InfoRow(
              label: 'Till short by',
              value: '${formatBDT(p.tillShortfall)} or more',
            ),
          ],
        ),
      );
    }
    return SectionCard(
      title: 'When the shop raises an alert',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _field('large_sale_amount', 'A sale of at least', _sale),
          _field('large_refund_amount', 'A refund of at least', _refund),
          _field('till_shortfall_amount', 'A till short by at least', _short),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: const Text('Save amounts'),
          ),
        ],
      ),
    );
  }
}
