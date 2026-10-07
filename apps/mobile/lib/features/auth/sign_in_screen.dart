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
      backgroundColor: AppColors.canvas,
      body: SafeArea(
        // Fills the screen so the sign-in sits at the bottom, in thumb reach,
        // and scrolls instead of overflowing on a short phone or with a long
        // error under the button.
        child: CustomScrollView(
          slivers: [
            SliverFillRemaining(
              hasScrollBody: false,
              child: Align(
                alignment: Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 400),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(24, 16, 24, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const _Wordmark(),
                        const SizedBox(height: 28),
                        Text(
                          'Your CRM, on your phone',
                          style: theme.textTheme.headlineSmall?.copyWith(
                            fontSize: 26,
                            fontWeight: FontWeight.w700,
                            letterSpacing: -0.5,
                            height: 1.15,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          'Sign in to pick up where you left off on the web.',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            fontSize: 15,
                            color: AppColors.textSecondary,
                          ),
                        ),
                        const SizedBox(height: 20),
                        const _WhatsInside(),
                        const SizedBox(height: 24),
                        const Spacer(),
                        if (notice != null && _error == null) ...[
                          InlineNotice(message: notice),
                          const SizedBox(height: 12),
                        ],
                        _GoogleButton(busy: _busy, onPressed: _signIn),
                        if (_error != null) ...[
                          const SizedBox(height: 12),
                          InlineNotice(message: _error!, tone: Tone.danger),
                        ],
                        const SizedBox(height: 10),
                        Text(
                          'Use the Google account you sign in with on '
                          'app.erp71.com.',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodySmall,
                        ),
                        const SizedBox(height: 4),
                        Wrap(
                          alignment: WrapAlignment.center,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Text(
                              'New to ERP71?',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: AppColors.textSecondary,
                              ),
                            ),
                            TextButton(
                              onPressed: () => launchUrl(
                                webAppUrl,
                                mode: LaunchMode.externalApplication,
                              ),
                              child: const Text('Create a workspace'),
                            ),
                          ],
                        ),
                        if (kDebugMode)
                          Text(
                            'API: ${ref.watch(appConfigProvider).apiBaseUrl}',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: AppColors.textHint,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Google's own light button (its sign-in branding guidelines): white, a
/// gray-green stroke, near-black label. While busy it keeps a label next to
/// the spinner, so a slow picker doesn't look like a dead button.
class _GoogleButton extends StatelessWidget {
  const _GoogleButton({required this.busy, required this.onPressed});

  final bool busy;
  final VoidCallback onPressed;

  static const _stroke = Color(0xFF747775);
  static const _label = Color(0xFF1F1F1F);

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: busy ? null : onPressed,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(48),
        backgroundColor: AppColors.surface,
        foregroundColor: _label,
        side: BorderSide(color: busy ? AppColors.border : _stroke),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
      ),
      child: busy
          ? const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                SizedBox(width: 10),
                Flexible(
                  child: Text('Signing in…', overflow: TextOverflow.ellipsis),
                ),
              ],
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
    );
  }
}

/// What the app holds, with the icons its bottom navigation uses, so the
/// first screen previews the one a person lands on.
class _WhatsInside extends StatelessWidget {
  const _WhatsInside();

  @override
  Widget build(BuildContext context) {
    return const Card(
      child: Column(
        children: [
          _Feature(
            icon: Icons.people_alt_outlined,
            title: 'Leads by stage',
            detail: 'See your pipeline and move a lead to its next stage.',
          ),
          Divider(),
          _Feature(
            icon: Icons.event_note_outlined,
            title: 'Follow-ups and calls',
            detail: "Plan the next follow-up, log a call, see today's work.",
          ),
          Divider(),
          _Feature(
            icon: Icons.contacts_outlined,
            title: 'Contacts',
            detail: "Your customers' details wherever you are.",
          ),
        ],
      ),
    );
  }
}

class _Feature extends StatelessWidget {
  const _Feature({
    required this.icon,
    required this.title,
    required this.detail,
  });

  final IconData icon;
  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppColors.primaryTint,
              borderRadius: BorderRadius.circular(AppRadius.control),
            ),
            child: Icon(icon, size: 20, color: AppColors.primary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: theme.textTheme.titleMedium),
                const SizedBox(height: 2),
                Text(detail, style: theme.textTheme.bodySmall),
              ],
            ),
          ),
        ],
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
          width: 32,
          height: 32,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: AppColors.primary,
            borderRadius: BorderRadius.circular(AppRadius.control),
          ),
          child: const Text(
            '71',
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
              fontSize: 13,
            ),
          ),
        ),
        const SizedBox(width: 8),
        const Text(
          'ERP71',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w800,
            color: AppColors.text,
            letterSpacing: -0.3,
          ),
        ),
      ],
    );
  }
}
