import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

/// A business-card photo, downscaled and ready to send.
class CardPhoto {
  const CardPhoto({required this.dataUrl, required this.mimeType});

  /// `data:<mime>;base64,…`, the form both the scan and attachment endpoints take.
  final String dataUrl;
  final String mimeType;
}

enum CardPhotoSource { camera, gallery }

typedef CardPhotoPicker = Future<CardPhoto?> Function(CardPhotoSource source);

/// Longest edge sent. Card text stays legible well below the camera's native size.
const _maxEdge = 1600.0;
const _quality = 85;

/// Takes or chooses a card photo; null when the user backs out.
/// Overridable so tests need no camera.
final cardPhotoPickerProvider = Provider<CardPhotoPicker>((ref) {
  final picker = ImagePicker();
  return (source) async {
    final file = await picker.pickImage(
      source: source == CardPhotoSource.camera
          ? ImageSource.camera
          : ImageSource.gallery,
      maxWidth: _maxEdge,
      maxHeight: _maxEdge,
      imageQuality: _quality,
    );
    if (file == null) return null;
    final bytes = await file.readAsBytes();
    // Picked images are re-encoded as JPEG when resized; a PNG passed through
    // untouched keeps its own type.
    final mime = file.mimeType ?? _mimeFromName(file.name);
    return CardPhoto(
      dataUrl: 'data:$mime;base64,${base64Encode(bytes)}',
      mimeType: mime,
    );
  };
});

String _mimeFromName(String name) {
  final lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.heic')) return 'image/heic';
  return 'image/jpeg';
}
