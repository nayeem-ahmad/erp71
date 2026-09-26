import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api/api_exception.dart';
import '../../core/auth/auth_controller.dart';
import '../../core/auth/auth_repository.dart';
import '../../core/auth/google_auth.dart';
import '../../core/providers.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'google_logo.dart';

/// Where a new customer creates their workspace — signing up is the web's job.
final Uri webAppUrl = Uri.parse('https://app.erp71.com');

class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authControllerProvider.notifier).signInWithGoogle();
    } on NoAccountForGoogle catch (e) {
      _error = e.message;
    } on GoogleAuthException catch (e) {
      _error = e.message;
    } on ApiException catch (e) {
      _error = e.message;
    } catch (_) {
      // The Google plugin can fail in platform-specific ways; none of them
      // should leave the button doing nothing.
      _error = 'Sign-in failed. Try again.';
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final auth = ref.watch(authControllerProvider);
    final notice = auth is AuthSignedOut ? auth.notice : null;

    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const _Wordmark(),
                  const SizedBox(height: 32),
                  Text(
                    'Sign in',
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      fontSize: 22,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    'Use the Google account you use for ERP71 on the web.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 24),
                  if (notice != null && _error == null) ...[
                    InlineNotice(message: notice),
                    const SizedBox(height: 16),
                  ],
                  OutlinedButton(
                    onPressed: _busy ? null : _signIn,
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      backgroundColor: AppColors.surface,
                    ),
                    child: _busy
                        ? const SizedBox.square(
                            dimension: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              GoogleLogo(),
                              SizedBox(width: 12),
                              Flexible(
                                child: Text(
                                  'Continue with Google',
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 16),
                    InlineNotice(message: _error!, tone: Tone.danger),
                  ],
                  const SizedBox(height: 32),
                  Text(
                    'New to ERP71?',
                    textAlign: TextAlign.center,
                    style: theme.textTheme.bodySmall,
                  ),
                  TextButton(
                    onPressed: () => launchUrl(
                      webAppUrl,
                      mode: LaunchMode.externalApplication,
                    ),
                    child: const Text('Create your workspace at app.erp71.com'),
                  ),
                  if (kDebugMode) ...[
                    const SizedBox(height: 24),
                    Text(
                      'API: ${ref.watch(appConfigProvider).apiBaseUrl}',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: AppColors.textHint,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Wordmark extends StatelessWidget {
  const _Wordmark();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 40,
          height: 40,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.primary,
            borderRadius: BorderRadius.circular(AppRadius.card),
          ),
          child: const Text(
            '71',
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
              fontSize: 16,
            ),
          ),
        ),
        const SizedBox(width: 10),
        const Text(
          'ERP71',
          style: TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w800,
            color: AppColors.text,
            letterSpacing: -0.3,
          ),
        ),
      ],
    );
  }
}
