import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../core/security/app_lock.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Wraps the whole app (MaterialApp's `builder`), so the cover sits over
/// every route, sheet and dialog alike. The app underneath stays mounted:
/// unlocking returns to exactly the screen that was open.
class AppLockGate extends ConsumerStatefulWidget {
  const AppLockGate({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<AppLockGate> createState() => _AppLockGateState();
}

class _AppLockGateState extends ConsumerState<AppLockGate> {
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    // Hidden and shown, not paused and resumed: the fingerprint prompt makes
    // the app inactive, and treating that as leaving would relock it the
    // moment it unlocked.
    _lifecycle = AppLifecycleListener(
      onHide: () => ref.read(appLockProvider.notifier).hidden(),
      onShow: () => ref.read(appLockProvider.notifier).shown(),
    );
  }

  @override
  void dispose() {
    _lifecycle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lock = ref.watch(appLockProvider);
    final signedIn = ref.watch(authControllerProvider) is AuthSignedIn;
    // Nothing to protect before sign-in. While the setting is still being
    // read, cover rather than risk showing the shop for a frame.
    final covered = signedIn && (!lock.loaded || lock.locked);

    return Stack(
      fit: StackFit.expand,
      children: [
        ExcludeSemantics(
          excluding: covered,
          child: TickerMode(enabled: !covered, child: widget.child),
        ),
        if (covered)
          lock.loaded
              ? const _LockScreen()
              : const ColoredBox(color: AppColors.canvas),
      ],
    );
  }
}

class _LockScreen extends ConsumerStatefulWidget {
  const _LockScreen();

  @override
  ConsumerState<_LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends ConsumerState<_LockScreen> {
  bool _asking = false;

  @override
  void initState() {
    super.initState();
    // Ask straight away, once. If they cancel, the button asks again; asking
    // in a loop would trap them in the prompt.
    SchedulerBinding.instance.addPostFrameCallback((_) => _unlock());
  }

  Future<void> _unlock() async {
    if (_asking || !mounted) return;
    setState(() => _asking = true);
    try {
      await ref.read(appLockProvider.notifier).unlock();
    } finally {
      if (mounted) setState(() => _asking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final workspace = auth is AuthSignedIn ? auth.workspace : null;
    return Material(
      color: AppColors.canvas,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              const Spacer(),
              const Icon(
                Icons.lock_outline,
                size: 48,
                color: AppColors.primary,
              ),
              const SizedBox(height: 16),
              Text(
                'ERP71 is locked',
                style: Theme.of(context).textTheme.titleLarge,
                textAlign: TextAlign.center,
              ),
              if (workspace != null) ...[
                const SizedBox(height: 4),
                Text(
                  workspace.name,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: AppColors.textSecondary),
                ),
              ],
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: _asking ? null : _unlock,
                icon: const Icon(Icons.fingerprint),
                label: const Text('Unlock'),
              ),
              const Spacer(),
              TextButton(
                onPressed: _asking
                    ? null
                    : () => ref.read(authControllerProvider.notifier).signOut(),
                child: const Text('Sign out instead'),
              ),
              const Text(
                'Signing out needs your Google account to get back in.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The App lock switch on the account screen.
class AppLockSetting extends ConsumerStatefulWidget {
  const AppLockSetting({super.key});

  @override
  ConsumerState<AppLockSetting> createState() => _AppLockSettingState();
}

class _AppLockSettingState extends ConsumerState<AppLockSetting> {
  bool _busy = false;

  Future<void> _toggle(bool on) async {
    setState(() => _busy = true);
    final controller = ref.read(appLockProvider.notifier);
    try {
      if (!on) {
        await controller.disable();
        showToast('App lock is off');
        return;
      }
      switch (await controller.enable()) {
        case AppLockEnableResult.enabled:
          showToast('App lock is on', tone: Tone.success);
        case AppLockEnableResult.cancelled:
          break;
        case AppLockEnableResult.noScreenLock:
          showToast(
            'Set a screen lock on this phone first, then turn this on.',
            tone: Tone.danger,
          );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lock = ref.watch(appLockProvider);
    return SwitchListTile(
      contentPadding: EdgeInsets.zero,
      tileColor: Colors.transparent,
      title: const Text('App lock'),
      subtitle: const Text(
        'Ask for your fingerprint, face or phone PIN when ERP71 opens, '
        'and after 5 minutes away.',
      ),
      value: lock.enabled,
      onChanged: !lock.loaded || _busy ? null : _toggle,
    );
  }
}
