import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/auth/auth_controller.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Shown while the stored session is checked, and when that check could not
/// reach the server — a state that is not "signed out", so it offers a retry
/// before it offers signing in again.
class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    final controller = ref.read(authControllerProvider.notifier);

    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: auth is AuthRestoreFailed
            ? ErrorView(message: auth.message, onRetry: controller.restore)
            : const LoadingView(),
      ),
      bottomNavigationBar: auth is AuthRestoreFailed
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: TextButton(
                  onPressed: controller.signOut,
                  child: const Text('Sign out'),
                ),
              ),
            )
          : null,
    );
  }
}
