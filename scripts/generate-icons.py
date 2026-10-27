from pathlib import Path
import struct
import zlib


def png_chunk(kind: bytes, data: bytes) -> bytes:
    payload = kind + data
    return struct.pack('>I', len(data)) + payload + struct.pack('>I', zlib.crc32(payload) & 0xFFFFFFFF)


def make_icon(size: int, destination: Path) -> None:
    background = (16, 16, 15)
    amber = (212, 164, 91)
    glyphs = {
        'f': ('01110', '01000', '11100', '01000', '01000', '01000', '01000'),
        'i': ('00100', '00000', '01100', '00100', '00100', '00100', '01110'),
        'v': ('00000', '00000', '10001', '10001', '10001', '01010', '00100'),
        'e': ('00000', '00000', '01110', '10001', '11111', '10000', '01110'),
    }
    word = 'five'
    scale = max(1, round(size * 0.028))
    spacing = scale
    word_width = (len(word) * 5 + len(word) - 1) * scale
    word_height = 7 * scale
    text_left = (size - word_width) // 2
    text_top = (size - word_height) // 2
    rows = bytearray()

    for y in range(size):
        rows.append(0)  # PNG filter: none
        for x in range(size):
            color = background
            rel_y = y - text_top
            if 0 <= rel_y < word_height:
                char_width = 5 * scale + spacing
                char_index, within_char_x = divmod(x - text_left, char_width)
                if 0 <= char_index < len(word) and 0 <= within_char_x < 5 * scale:
                    rel_x = within_char_x // scale
                    rel_row = rel_y // scale
                    if glyphs[word[char_index]][rel_row][rel_x] == '1':
                        color = amber
            rows.extend(color)

    image = b'\x89PNG\r\n\x1a\n'
    image += png_chunk(b'IHDR', struct.pack('>2I5B', size, size, 8, 2, 0, 0, 0))
    image += png_chunk(b'IDAT', zlib.compress(bytes(rows), 9))
    image += png_chunk(b'IEND', b'')
    destination.write_bytes(image)


public = Path(__file__).resolve().parents[1] / 'public'
for size, name in [(180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]:
    make_icon(size, public / name)
