import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
    final insets = MediaQuery.paddingOf(context);

    // White status-bar icons over the blue panel.
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(
        statusBarColor: Colors.transparent,
      ),
      child: Scaffold(
        backgroundColor: AppColors.surface,
        // Fills the screen so the footer sits at the bottom, and scrolls
        // instead of overflowing on a short phone or with a long error under
        // the button.
        body: CustomScrollView(
          slivers: [
            SliverFillRemaining(
              hasScrollBody: false,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _BrandPanel(topInset: insets.top),
                  Expanded(
                    // Blue behind the sheet's rounded corners, so the sheet
                    // reads as lying over the panel.
                    child: ColoredBox(
                      color: AppColors.primary,
                      child: DecoratedBox(
                        decoration: const BoxDecoration(
                          color: AppColors.surface,
                          borderRadius: BorderRadius.vertical(
                            top: Radius.circular(AppRadius.sheet),
                          ),
                        ),
                        child: Align(
                          alignment: Alignment.topCenter,
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 400),
                            child: Padding(
                              padding: EdgeInsets.fromLTRB(
                                24,
                                26,
                                24,
                                insets.bottom + 8,
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Text(
                                    'Sign in',
                                    style: theme.textTheme.headlineSmall
                                        ?.copyWith(
                                          fontWeight: FontWeight.w700,
                                          fontSize: 22,
                                        ),
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    'Use the Google account you use for ERP71 '
                                    'on the web.',
                                    style: theme.textTheme.bodyMedium?.copyWith(
                                      color: AppColors.textSecondary,
                                    ),
                                  ),
                                  const SizedBox(height: 20),
                                  if (notice != null && _error == null) ...[
                                    InlineNotice(message: notice),
                                    const SizedBox(height: 12),
                                  ],
                                  _GoogleButton(
                                    busy: _busy,
                                    onPressed: _signIn,
                                  ),
                                  if (_error != null) ...[
                                    const SizedBox(height: 12),
                                    InlineNotice(
                                      message: _error!,
                                      tone: Tone.danger,
                                    ),
                                  ],
                                  const SizedBox(height: 24),
                                  const Spacer(),
                                  Text(
                                    'New to ERP71?',
                                    textAlign: TextAlign.center,
                                    style: theme.textTheme.bodySmall?.copyWith(
                                      fontSize: 13,
                                    ),
                                  ),
                                  TextButton(
                                    onPressed: () => launchUrl(
                                      webAppUrl,
                                      mode: LaunchMode.externalApplication,
                                    ),
                                    child: const Text(
                                      'Create your workspace at app.erp71.com',
                                    ),
                                  ),
                                  if (kDebugMode)
                                    Text(
                                      'API: '
                                      '${ref.watch(appConfigProvider).apiBaseUrl}',
                                      textAlign: TextAlign.center,
                                      style: theme.textTheme.bodySmall
                                          ?.copyWith(color: AppColors.textHint),
                                    ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
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

/// The blue top of the screen: the mark, name, tagline and what the app
/// holds, over a dot grid that fades out toward the sheet. Everything is
/// drawn in code, so there are no image assets to keep in step.
class _BrandPanel extends StatelessWidget {
  const _BrandPanel({required this.topInset});

  /// The status bar's height: the panel runs up behind it.
  final double topInset;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: AppColors.primary,
      child: Stack(
        children: [
          const Positioned.fill(child: CustomPaint(painter: _DotGrid())),
          Padding(
            padding: EdgeInsets.fromLTRB(24, topInset + 64, 24, 40),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 52,
                  height: 52,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(AppRadius.card),
                  ),
                  child: const Text(
                    '71',
                    style: TextStyle(
                      color: AppColors.primary,
                      fontWeight: FontWeight.w800,
                      fontSize: 19,
                    ),
                  ),
                ),
                const SizedBox(height: 18),
                const Text(
                  'ERP71',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 30,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.6,
                    height: 1.1,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Your CRM, on your phone.',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.88),
                    fontSize: 16,
                  ),
                ),
                const SizedBox(height: 14),
                const Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    _PanelChip('Leads'),
                    _PanelChip('Follow-ups'),
                    _PanelChip('Contacts'),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PanelChip extends StatelessWidget {
  const _PanelChip(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: ShapeDecoration(
        color: Colors.white.withValues(alpha: 0.14),
        shape: StadiumBorder(
          side: BorderSide(color: Colors.white.withValues(alpha: 0.24)),
        ),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 12,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

/// A faint dot grid, strongest at the top left and gone by the lower right.
class _DotGrid extends CustomPainter {
  const _DotGrid();

  static const _spacing = 18.0;

  @override
  void paint(Canvas canvas, Size size) {
    final dot = Paint();
    for (var y = _spacing / 2; y < size.height; y += _spacing) {
      for (var x = _spacing / 2; x < size.width; x += _spacing) {
        final fade = 1 - (0.35 * x / size.width + 0.9 * y / size.height);
        if (fade <= 0) continue;
        dot.color = Colors.white.withValues(alpha: 0.2 * fade);
        canvas.drawCircle(Offset(x, y), 1.1, dot);
      }
    }
  }

  @override
  bool shouldRepaint(_DotGrid oldDelegate) => false;
}
