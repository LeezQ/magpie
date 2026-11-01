"""Validate a complete StallionX release and write deterministic SHA-256 hashes.

Only the six expected packages enter a release. Refuse empty files, symlinks,
extra files, malformed versions, and a signed/unsigned filename mismatch.
Run --test for offline contract checks; no network or credential access.
"""
import hashlib
import pathlib
import re
import sys
import tempfile
import unittest


def expected(version, signed):
    if not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version):
        raise ValueError("version must be X.Y.Z")
    if signed not in ("true", "false"):
        raise ValueError("sign_macos must be true or false")
    suffix = "" if signed == "true" else "-unsigned"
    return sorted(
        [f"StallionX-{version}-macos-{arch}{suffix}.{ext}"
         for arch in ("arm64", "amd64") for ext in ("zip", "dmg")]
        + [f"StallionX-{version}-windows-{arch}-unsigned.zip"
           for arch in ("amd64", "arm64")]
    )


def validate(folder, version, signed):
    names = expected(version, signed)
    if sorted(p.name for p in folder.iterdir()) != names:
        raise ValueError("release must contain exactly the six expected Mac/Windows packages")
    lines = []
    for name in names:
        path = folder / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f"invalid release asset: {name}")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        lines.append(f"{digest}  {name}\n")
    # Exclusive creation prevents accidentally replacing a published manifest.
    with (folder / "SHA256SUMS").open("x", encoding="utf-8", newline="\n") as stream:
        stream.writelines(lines)


class ReleaseAssetsTest(unittest.TestCase):
    def test_complete(self):
        for signed in ("true", "false"):
            with tempfile.TemporaryDirectory() as directory:
                folder = pathlib.Path(directory)
                for name in expected("1.2.3", signed):
                    (folder / name).write_bytes(b"fixture")
                validate(folder, "1.2.3", signed)
                lines = (folder / "SHA256SUMS").read_text().splitlines()
                # Check the digest and name for every asset, not only line count:
                # a manifest with six incorrect hashes is unusable for downloads.
                digest = hashlib.sha256(b"fixture").hexdigest()
                self.assertEqual(lines, [f"{digest}  {name}" for name in expected("1.2.3", signed)])
                with self.assertRaises(ValueError):
                    validate(folder, "1.2.3", signed)

    def test_missing_empty_extra(self):
        for failure in ("missing", "empty", "extra"):
            with tempfile.TemporaryDirectory() as directory:
                folder = pathlib.Path(directory)
                names = expected("1.2.3", "false")
                for name in names:
                    (folder / name).write_bytes(b"fixture")
                if failure == "missing":
                    (folder / names[0]).unlink()
                elif failure == "empty":
                    (folder / names[0]).write_bytes(b"")
                else:
                    (folder / "private-key.txt").write_bytes(b"fixture")
                with self.assertRaises(ValueError):
                    validate(folder, "1.2.3", "false")
                self.assertFalse((folder / "SHA256SUMS").exists())

    def test_inputs(self):
        for version in ("v1.2.3", "1.2", "01.2.3", "1.2.3\n", "../../private"):
            with self.assertRaises(ValueError):
                expected(version, "false")
        with self.assertRaises(ValueError):
            expected("1.2.3", "maybe")


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        unittest.main(argv=[sys.argv[0]])
    elif len(sys.argv) == 4:
        validate(pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3])
    else:
        sys.exit("usage: release-assets.py DIRECTORY X.Y.Z true|false | --test")
