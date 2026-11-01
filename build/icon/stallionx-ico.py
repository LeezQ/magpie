"""Package rendered StallionX PNGs as the Windows tray's multi-resolution ICO.

ICO supports PNG payloads directly; no image library or resampling is needed.
Keep the full executable size set so Windows can choose its actual DPI size.
"""
import pathlib
import struct
import sys

source, target = map(pathlib.Path, sys.argv[1:])
sizes = (16, 20, 24, 32, 40, 48, 64, 128, 256)
images = [(size, (source / f"icon-{size}.png").read_bytes()) for size in sizes]
offset = 6 + 16 * len(images)
entries = []
for size, image in images:
    # A zero dimension in the ICO directory encodes 256 pixels.
    entries.append(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0,
                               1, 32, len(image), offset))
    offset += len(image)
target.write_bytes(struct.pack("<HHH", 0, 1, len(images)) + b"".join(entries)
                   + b"".join(image for _, image in images))
