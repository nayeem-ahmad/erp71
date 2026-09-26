import 'package:flutter/material.dart';

/// The web app's tokens (docs/ui-design-guidelines.md §2.2): one accent,
/// blue-600, for every primary action and link; emerald for success, amber
/// for warning, red for danger; a gray-100 canvas under white surfaces.
abstract final class AppColors {
  static const primary = Color(0xFF2563EB); // blue-600
  static const primaryDark = Color(0xFF1D4ED8); // blue-700
  static const primaryTint = Color(0xFFEFF6FF); // blue-50

  static const success = Color(0xFF059669); // emerald-600
  static const successTint = Color(0xFFECFDF5); // emerald-50
  static const warning = Color(0xFFF59E0B); // amber-500
  static const warningText = Color(0xFFB45309); // amber-700, legible on white
  static const warningTint = Color(0xFFFFFBEB); // amber-50
  static const danger = Color(0xFFDC2626); // red-600
  static const dangerTint = Color(0xFFFEF2F2); // red-50

  static const canvas = Color(0xFFF3F4F6); // gray-100
  static const surface = Color(0xFFFFFFFF);
  static const inputFill = Color(0xFFF9FAFB); // gray-50
  static const border = Color(0xFFE5E7EB); // gray-200
  static const divider = Color(0xFFF3F4F6); // gray-100

  static const text = Color(0xFF111827); // gray-900
  static const textSecondary = Color(0xFF6B7280); // gray-500
  static const textHint = Color(0xFF9CA3AF); // gray-400
  static const label = Color(0xFF4B5563); // gray-600
  static const neutralTint = Color(0xFFF3F4F6); // gray-100
}

/// Three radius stops, as on the web: controls, cards, sheets.
abstract final class AppRadius {
  static const control = 6.0; // rounded-md
  static const card = 8.0; // rounded-lg
  static const sheet = 12.0; // rounded-xl
}

/// Minimum tappable size on a phone (the web's `min-h-touch`).
const double kTouchTarget = 44;

ThemeData buildAppTheme() {
  final scheme =
      ColorScheme.fromSeed(
        seedColor: AppColors.primary,
        brightness: Brightness.light,
      ).copyWith(
        primary: AppColors.primary,
        onPrimary: Colors.white,
        primaryContainer: AppColors.primaryTint,
        onPrimaryContainer: AppColors.primaryDark,
        secondary: AppColors.primary,
        onSecondary: Colors.white,
        error: AppColors.danger,
        onError: Colors.white,
        surface: AppColors.surface,
        onSurface: AppColors.text,
        onSurfaceVariant: AppColors.textSecondary,
        outline: AppColors.border,
        outlineVariant: AppColors.divider,
        surfaceContainerLowest: AppColors.surface,
        surfaceContainerLow: AppColors.surface,
        surfaceContainer: AppColors.surface,
        surfaceContainerHigh: AppColors.surface,
        surfaceContainerHighest: AppColors.neutralTint,
      );

  const controlShape = RoundedRectangleBorder(
    borderRadius: BorderRadius.all(Radius.circular(AppRadius.control)),
  );
  OutlineInputBorder inputBorder(Color color, [double width = 1]) =>
      OutlineInputBorder(
        borderRadius: BorderRadius.circular(AppRadius.control),
        borderSide: BorderSide(color: color, width: width),
      );

  final base = ThemeData(useMaterial3: true, colorScheme: scheme);
  final text = base.textTheme.apply(
    bodyColor: AppColors.text,
    displayColor: AppColors.text,
  );

  return base.copyWith(
    scaffoldBackgroundColor: AppColors.canvas,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    visualDensity: VisualDensity.standard,
    textTheme: text.copyWith(
      // Page title: text-lg font-bold.
      titleLarge: text.titleLarge?.copyWith(
        fontSize: 18,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.2,
      ),
      // Section / card title: text-sm font-semibold.
      titleMedium: text.titleMedium?.copyWith(
        fontSize: 14,
        fontWeight: FontWeight.w600,
      ),
      titleSmall: text.titleSmall?.copyWith(
        fontSize: 13,
        fontWeight: FontWeight.w600,
      ),
      bodyLarge: text.bodyLarge?.copyWith(fontSize: 15),
      bodyMedium: text.bodyMedium?.copyWith(fontSize: 14),
      bodySmall: text.bodySmall?.copyWith(
        fontSize: 12,
        color: AppColors.textSecondary,
      ),
      labelLarge: text.labelLarge?.copyWith(
        fontSize: 14,
        fontWeight: FontWeight.w600,
      ),
      labelMedium: text.labelMedium?.copyWith(
        fontSize: 12,
        fontWeight: FontWeight.w500,
        color: AppColors.label,
      ),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.surface,
      foregroundColor: AppColors.text,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontSize: 18,
        fontWeight: FontWeight.w700,
        color: AppColors.text,
        letterSpacing: -0.2,
      ),
      shape: Border(bottom: BorderSide(color: AppColors.border)),
    ),
    cardTheme: const CardThemeData(
      color: AppColors.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(AppRadius.card)),
        side: BorderSide(color: AppColors.border),
      ),
    ),
    dividerTheme: const DividerThemeData(
      color: AppColors.divider,
      space: 1,
      thickness: 1,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(64, kTouchTarget),
        shape: controlShape,
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(64, kTouchTarget),
        shape: controlShape,
        foregroundColor: AppColors.text,
        side: const BorderSide(color: AppColors.border),
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(44, kTouchTarget),
        shape: controlShape,
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.inputFill,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      labelStyle: const TextStyle(fontSize: 14, color: AppColors.label),
      floatingLabelStyle: const TextStyle(color: AppColors.primary),
      hintStyle: const TextStyle(fontSize: 14, color: AppColors.textHint),
      helperStyle: const TextStyle(
        fontSize: 12,
        color: AppColors.textSecondary,
      ),
      errorStyle: const TextStyle(fontSize: 12, color: AppColors.danger),
      border: inputBorder(AppColors.border),
      enabledBorder: inputBorder(AppColors.border),
      focusedBorder: inputBorder(AppColors.primary.withValues(alpha: 0.6), 1.5),
      errorBorder: inputBorder(AppColors.danger),
      focusedErrorBorder: inputBorder(AppColors.danger, 1.5),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: AppColors.surface,
      selectedColor: AppColors.primaryTint,
      side: const BorderSide(color: AppColors.border),
      shape: const StadiumBorder(),
      labelStyle: const TextStyle(fontSize: 13, color: AppColors.text),
      secondaryLabelStyle: const TextStyle(
        fontSize: 13,
        color: AppColors.primaryDark,
      ),
      checkmarkColor: AppColors.primaryDark,
    ),
    listTileTheme: const ListTileThemeData(
      tileColor: AppColors.surface,
      iconColor: AppColors.textSecondary,
      minVerticalPadding: 10,
      titleTextStyle: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: AppColors.text,
      ),
      subtitleTextStyle: TextStyle(
        fontSize: 12,
        color: AppColors.textSecondary,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: AppColors.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: AppColors.primaryTint,
      height: 64,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 12,
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w600
              : FontWeight.w500,
          color: states.contains(WidgetState.selected)
              ? AppColors.primary
              : AppColors.textSecondary,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          color: states.contains(WidgetState.selected)
              ? AppColors.primary
              : AppColors.textSecondary,
        ),
      ),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: AppColors.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(AppRadius.sheet),
        ),
      ),
    ),
    dialogTheme: const DialogThemeData(
      backgroundColor: AppColors.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(AppRadius.sheet)),
      ),
    ),
    snackBarTheme: const SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: AppColors.text,
      contentTextStyle: TextStyle(fontSize: 14, color: Colors.white),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(AppRadius.card)),
      ),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: AppColors.primary,
    ),
  );
}
