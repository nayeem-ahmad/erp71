import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/auth/auth_controller.dart';
import '../../../core/format/format.dart';
import '../../../ui/theme.dart';
import '../../../ui/widgets.dart';
import '../data/business_providers.dart';

/// A tab's title with the workspace under it, as on the CRM overview.
class TitleWithWorkspace extends ConsumerWidget {
  const TitleWithWorkspace(this.title, {super.key});

  final String title;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workspace = ref.watch(activeWorkspaceProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title),
        if (workspace != null)
          Text(
            workspace.name,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w400,
              color: AppColors.textSecondary,
            ),
          ),
      ],
    );
  }
}

/// Which branch the figures are for. Hidden when there is only one.
class BranchFilter extends ConsumerWidget {
  const BranchFilter({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workspace = ref.watch(activeWorkspaceProvider);
    if (workspace == null) return const SizedBox.shrink();
    final choices = branchChoices(workspace);
    if (choices.length < 2) return const SizedBox.shrink();
    final selected = ref.watch(businessBranchProvider);
    final label = choices
        .firstWhere(
          (c) => c.id == selected,
          orElse: () => (id: '', name: 'Your branch'),
        )
        .name;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton.icon(
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(0, kTouchTarget),
          ),
          onPressed: () => showAppSheet<void>(
            context: context,
            title: 'Branch',
            builder: (sheetContext) => Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                for (final choice in choices)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    tileColor: Colors.transparent,
                    title: Text(choice.name),
                    trailing: choice.id == selected
                        ? const Icon(
                            Icons.check_circle,
                            color: AppColors.primary,
                          )
                        : null,
                    onTap: () {
                      Navigator.of(sheetContext).pop();
                      ref
                          .read(businessBranchProvider.notifier)
                          .select(choice.id);
                    },
                  ),
              ],
            ),
          ),
          icon: const Icon(Icons.storefront_outlined, size: 18),
          label: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 220),
                child: Text(label, overflow: TextOverflow.ellipsis),
              ),
              const SizedBox(width: 4),
              const Icon(Icons.unfold_more, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}

/// A labelled figure, two to a row.
class KpiTile extends StatelessWidget {
  const KpiTile({
    super.key,
    required this.label,
    required this.value,
    this.caption,
    this.tone = Tone.neutral,
    this.onTap,
  });

  final String label;
  final String value;
  final String? caption;
  final Tone tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 4),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    value,
                    maxLines: 1,
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: tone == Tone.neutral
                          ? AppColors.text
                          : tone.foreground,
                    ),
                  ),
                ),
                if (caption != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    caption!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 11,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A label, a bar for its share of the largest row, and the amount.
class ShareRow extends StatelessWidget {
  const ShareRow({
    super.key,
    required this.label,
    required this.amount,
    required this.share,
  });

  final String label;
  final double amount;

  /// 0–1 of the largest row.
  final double share;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          SizedBox(
            width: 96,
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13),
            ),
          ),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: LinearProgressIndicator(
                minHeight: 8,
                value: share.clamp(0, 1).toDouble(),
                backgroundColor: AppColors.neutralTint,
                color: AppColors.primary,
              ),
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 104,
            child: Text(
              formatBDT(amount),
              textAlign: TextAlign.right,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

/// A label and a value on one line, with an optional tone for the value.
class FigureLine extends StatelessWidget {
  const FigureLine({
    super.key,
    required this.label,
    required this.value,
    this.tone = Tone.neutral,
    this.strong = false,
  });

  final String label;
  final String value;
  final Tone tone;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13,
                color: strong ? AppColors.text : AppColors.textSecondary,
                fontWeight: strong ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: tone == Tone.neutral ? AppColors.text : tone.foreground,
            ),
          ),
        ],
      ),
    );
  }
}

/// How a closed shift's count came out, for a badge.
({String label, Tone tone}) varianceBadge(double? variance) {
  if (variance == null) return (label: 'Not reconciled', tone: Tone.neutral);
  // Under a taka is rounding, not a discrepancy.
  if (variance.abs() < 1) return (label: 'Balanced', tone: Tone.success);
  if (variance < 0) {
    return (
      label: 'Short ${formatBDT(-variance)}',
      // A few taka short is a counting slip; more is worth a question.
      tone: variance <= -shortfallAlertTaka ? Tone.danger : Tone.warning,
    );
  }
  return (label: 'Over ${formatBDT(variance)}', tone: Tone.warning);
}

/// A shortfall at or past this many taka is shown in red. The default the
/// mobile plan sets for the coming drawer-close alert.
const double shortfallAlertTaka = 500;
