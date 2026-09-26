import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Google's four-colour "G", drawn rather than shipped as an image asset.
class GoogleLogo extends StatelessWidget {
  const GoogleLogo({super.key, this.size = 18});

  final double size;

  @override
  Widget build(BuildContext context) => SizedBox.square(
    dimension: size,
    child: const CustomPaint(painter: _GooglePainter()),
  );
}

class _GooglePainter extends CustomPainter {
  const _GooglePainter();

  static const _blue = Color(0xFF4285F4);
  static const _green = Color(0xFF34A853);
  static const _yellow = Color(0xFFFBBC05);
  static const _red = Color(0xFFEA4335);

  @override
  void paint(Canvas canvas, Size size) {
    final stroke = size.width * 0.2;
    final rect = Rect.fromLTWH(
      stroke / 2,
      stroke / 2,
      size.width - stroke,
      size.height - stroke,
    );
    Paint arc(Color color) => Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke;

    double rad(double degrees) => degrees * math.pi / 180;

    // Angles run clockwise from 3 o'clock. The gap at the right, above the
    // bar, is the mouth of the G.
    canvas.drawArc(rect, rad(-40), rad(-95), false, arc(_red));
    canvas.drawArc(rect, rad(-135), rad(-90), false, arc(_yellow));
    canvas.drawArc(rect, rad(135), rad(-90), false, arc(_green));
    canvas.drawArc(rect, rad(45), rad(-45), false, arc(_blue));

    final barTop = size.height / 2 - stroke / 2;
    canvas.drawRect(
      Rect.fromLTWH(size.width / 2, barTop, size.width / 2, stroke),
      Paint()..color = _blue,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
