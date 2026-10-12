import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_exception.dart';
import '../../core/format/format.dart';
import '../../core/security/app_lock.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../business/widgets/business_widgets.dart' show TitleWithWorkspace;
import '../home/home_shell.dart';
import 'approvals_data.dart';

/// Everything waiting for this person's decision, oldest first, filterable by
/// kind. Tapping one opens it with Approve and Reject.
class ApprovalsScreen extends ConsumerStatefulWidget {
  const ApprovalsScreen({super.key});

  @override
  ConsumerState<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _ApprovalsScreenState extends ConsumerState<ApprovalsScreen> {
  ApprovalKind? _filter;

  @override
  Widget build(BuildContext context) {
    final inbox = ref.watch(approvalsInboxProvider);
    return Scaffold(
      appBar: AppBar(
        title: const TitleWithWorkspace('Approvals'),
        actions: const [AccountButton()],
      ),
      body: inbox.when(
        skipLoadingOnRefresh: true,
        loading: () => const LoadingView(),
        error: (error, _) => ErrorView(
          message: describeError(error),
          onRetry: () => ref.invalidate(approvalsInboxProvider),
        ),
        data: (data) {
          final shown = [
            for (final item in data.items)
              if (_filter == null || item.kind == _filter) item,
          ];
          return RefreshIndicator(
            onRefresh: () => ref.refresh(approvalsInboxProvider.future),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(12),
              children: [
                if (data.kinds.length > 1) ...[
                  _KindFilter(
                    inbox: data,
                    selected: _filter,
                    onSelected: (kind) => setState(() => _filter = kind),
                  ),
                  const SizedBox(height: 8),
                ],
                if (shown.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 48),
                    child: EmptyView(
                      icon: Icons.task_alt,
                      title: 'Nothing waiting',
                      message:
                          'Expense claims, leave, product demands, stock '
                          'transfers and vouchers that need you show up here.',
                    ),
                  )
                else
                  for (final item in shown)
                    _ItemCard(item: item, onTap: () => _open(item)),
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _open(ApprovalItem item) async {
    final decided = await showAppSheet<bool>(
      context: context,
      title: item.kind.label,
      builder: (_) => _DecisionSheet(item: item),
    );
    if (decided == true) ref.invalidate(approvalsInboxProvider);
  }
}

class _KindFilter extends StatelessWidget {
  const _KindFilter({
    required this.inbox,
    required this.selected,
    required this.onSelected,
  });

  final ApprovalInbox inbox;
  final ApprovalKind? selected;
  final ValueChanged<ApprovalKind?> onSelected;

  @override
  Widget build(BuildContext context) {
    int count(ApprovalKind kind) =>
        inbox.items.where((item) => item.kind == kind).length;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          ChoiceChip(
            label: Text('All ${inbox.total}'),
            selected: selected == null,
            onSelected: (_) => onSelected(null),
          ),
          for (final kind in inbox.kinds) ...[
            const SizedBox(width: 8),
            ChoiceChip(
              label: Text('${kind.plural} ${count(kind)}'),
              selected: selected == kind,
              onSelected: (_) => onSelected(selected == kind ? null : kind),
            ),
          ],
        ],
      ),
    );
  }
}

class _ItemCard extends StatelessWidget {
  const _ItemCard({required this.item, required this.onTap});

  final ApprovalItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final who = [
      ?item.requestedBy,
      ?item.branch,
      formatAgo(item.requestedAt),
    ].join(' · ');
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    StatusBadge(item.kind.label, tone: Tone.primary),
                    const SizedBox(height: 6),
                    Text(
                      item.title,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      who,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              if (item.amount != null) ...[
                const SizedBox(width: 8),
                Text(
                  formatBDT(item.amount),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The entry, a note or reason, and the two buttons. Pops true once decided
/// (or found already decided), so the list reloads.
class _DecisionSheet extends ConsumerStatefulWidget {
  const _DecisionSheet({required this.item});

  final ApprovalItem item;

  @override
  ConsumerState<_DecisionSheet> createState() => _DecisionSheetState();
}

class _DecisionSheetState extends ConsumerState<_DecisionSheet> {
  final _note = TextEditingController();
  bool _busy = false;
  String? _reasonError;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _approve() async {
    final item = widget.item;
    if ((item.amount ?? 0) >= confirmApprovalAbove) {
      final auth = ref.read(deviceAuthenticatorProvider);
      // A phone with no screen lock has nothing to check; the app lock's own
      // rule applies there too.
      if (await auth.isAvailable()) {
        final result = await auth.authenticate(
          'Confirm approving ${formatBDT(item.amount)}',
        );
        if (result == DeviceAuthResult.failed) return;
      }
    }
    await _send(
      () =>
          ref.read(approvalsRepositoryProvider).approve(item, note: _note.text),
      done: '${item.kind.label} approved',
    );
  }

  Future<void> _reject() async {
    if (_note.text.trim().isEmpty) {
      setState(() => _reasonError = 'Say why, so they know what to change.');
      return;
    }
    await _send(
      () => ref
          .read(approvalsRepositoryProvider)
          .reject(widget.item, reason: _note.text),
      done: '${widget.item.kind.label} rejected',
    );
  }

  Future<void> _send(
    Future<void> Function() call, {
    required String done,
  }) async {
    setState(() => _busy = true);
    try {
      await call();
      showToast(done, tone: Tone.success);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (e.statusCode == 409) {
        // Someone else decided it first: say so, and drop it from the list.
        showToast(e.message);
        if (mounted) Navigator.of(context).pop(true);
        return;
      }
      showToast(e.message, tone: Tone.danger);
    } catch (e) {
      showToast(describeError(e), tone: Tone.danger);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(item.title, style: Theme.of(context).textTheme.titleMedium),
        if (item.amount != null) ...[
          const SizedBox(height: 4),
          Text(
            formatBDT(item.amount),
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
          ),
        ],
        const SizedBox(height: 8),
        if (item.requestedBy != null)
          InfoRow(label: 'Asked by', value: item.requestedBy!),
        if (item.branch != null) InfoRow(label: 'Branch', value: item.branch!),
        InfoRow(
          label: 'Waiting since',
          value: formatDateTime(item.requestedAt),
        ),
        for (final detail in item.details)
          InfoRow(label: detail.label, value: detail.value),
        const SizedBox(height: 12),
        TextField(
          controller: _note,
          minLines: 1,
          maxLines: 3,
          maxLength: 500,
          textCapitalization: TextCapitalization.sentences,
          onChanged: (_) {
            if (_reasonError != null) setState(() => _reasonError = null);
          },
          decoration: InputDecoration(
            labelText: 'Note (required to reject)',
            errorText: _reasonError,
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.danger,
                  minimumSize: const Size(0, kTouchTarget),
                ),
                onPressed: _busy ? null : _reject,
                child: const Text('Reject'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton(
                style: FilledButton.styleFrom(
                  minimumSize: const Size(0, kTouchTarget),
                ),
                onPressed: _busy ? null : _approve,
                child: const Text('Approve'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
