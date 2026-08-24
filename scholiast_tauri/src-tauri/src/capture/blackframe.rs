//! Black-frame detection, ported verbatim from the extension's semantics
//! (`scholiast_flutter/assets/player.html` `isBlackFrame`): sample every 8th
//! pixel row/column, count samples whose r,g,b are all < 16, and declare the
//! frame black when >98% of samples qualify.

pub(crate) fn is_black_frame(rgba: &[u8], w: u32, h: u32) -> bool {
    if w == 0 || h == 0 {
        return true;
    }
    let expected = w as usize * h as usize * 4;
    if rgba.len() < expected {
        return true;
    }
    let step = 8usize;
    let width = w as usize;
    let mut samples = 0u64;
    let mut black = 0u64;
    let mut y = 0usize;
    while y < h as usize {
        let mut x = 0usize;
        while x < width {
            let i = (y * width + x) * 4;
            if rgba[i] < 16 && rgba[i + 1] < 16 && rgba[i + 2] < 16 {
                black += 1;
            }
            samples += 1;
            x += step;
        }
        y += step;
    }
    samples > 0 && (black as f64 / samples as f64) > 0.98
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fill(w: u32, h: u32, px: [u8; 4]) -> Vec<u8> {
        (0..w * h).flat_map(|_| px).collect()
    }

    #[test]
    fn all_black_buffer_is_black() {
        let buf = fill(32, 24, [4, 2, 6, 255]);
        assert!(is_black_frame(&buf, 32, 24));
    }

    #[test]
    fn bright_buffer_is_not_black() {
        let buf = fill(32, 24, [30, 30, 30, 255]);
        assert!(!is_black_frame(&buf, 32, 24));
    }

    #[test]
    fn mostly_black_with_bright_strip_is_not_black() {
        // >2% of grid samples bright => ratio <= 0.98 => not black.
        // Grid over 40x40 step 8 = 25 samples; 1 bright column of 5 = 20%.
        let mut buf = fill(40, 40, [0, 0, 0, 255]);
        for y in 0..40usize {
            for x in 32..40usize {
                let i = (y * 40 + x) * 4;
                buf[i..i + 3].copy_from_slice(&[255, 255, 255]);
            }
        }
        assert!(!is_black_frame(&buf, 40, 40));
    }

    #[test]
    fn threshold_boundary_matches_extension() {
        // Extension rule: black iff black/samples > 0.98 (strict), so a ratio
        // of exactly 0.98 must NOT count as black: 10x5 = 50 grid samples over
        // an 80x40 frame, one bright sample => 49/50 == 0.98.
        let mut buf = fill(80, 40, [10, 10, 10, 255]);
        let i = (32 * 80 + 72) * 4; // last grid point
        buf[i..i + 3].copy_from_slice(&[200, 200, 200]);
        assert!(!is_black_frame(&buf, 80, 40));

        // Just ABOVE the threshold does count: 8x7 = 56 samples over 64x56,
        // one bright sample => 55/56 ≈ 0.982 > 0.98.
        let mut buf = fill(64, 56, [10, 10, 10, 255]);
        let i2 = (48 * 64 + 56) * 4;
        buf[i2..i2 + 3].copy_from_slice(&[200, 200, 200]);
        assert!(is_black_frame(&buf, 64, 56));
    }

    #[test]
    fn empty_dimensions_are_black() {
        assert!(is_black_frame(&[], 0, 0));
    }

    #[test]
    fn truncated_buffer_fails_safe_to_black() {
        assert!(is_black_frame(&[0u8; 10], 32, 32));
    }
}
