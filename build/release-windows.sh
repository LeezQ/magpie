#!/usr/bin/env bash
# Build both Windows architectures in an isolated copy of tracked source. This
# avoids modifying existing dist files, embedded launchers or resource objects.
# Outputs are explicitly unsigned portable archives, not signed installers.
set -euo pipefail
version=${1:?usage: release-windows.sh X.Y.Z}
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { printf 'Invalid version\n' >&2; exit 1; }
root=$(git rev-parse --show-toplevel)
cd "$root"
# A release must describe committed bytes. The workflow checks out the exact tag.
[[ -z "$(git status --porcelain --untracked-files=normal)" ]] || { printf 'Commit changes before packaging\n' >&2; exit 1; }
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/source" "$root/dist"
git archive HEAD | tar -x -C "$stage/source"
(
  cd "$stage/source"
  make release-windows VERSION="$version"
)
# Python's ZIP writer is shared by native Windows and local cross-builds; no
# external archive tool and no developer HOME/config is ever packaged.
python3 -I - "$stage/source" "$root/dist" "$version" <<'PY'
import pathlib
import sys
import zipfile
source, output = map(pathlib.Path, sys.argv[1:3])
version = sys.argv[3]
for arch in ('amd64', 'arm64'):
    target = output / f'StallionX-{version}-windows-{arch}-unsigned.zip'
    # Refuse overwriting an earlier build with the same release name.
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(source / f'dist/stallionx-windows-{arch}.exe', 'StallionX/stallionx.exe')
        for name in ('LICENSE', 'THIRD_PARTY_NOTICES'):
            archive.write(source / name, f'StallionX/{name}')
        archive.writestr('StallionX/README.txt',
            'StallionX portable desktop client\n\n'
            'Extract the entire folder, then open stallionx.exe.\n'
            'Requires Windows 10 or later and Microsoft Edge WebView2 Runtime.\n'
            'This build is UNSIGNED. Windows may display a security warning.\n'
            'Download only from the publisher you trust; verify SHA256SUMS.\n'
            'Default service: https://x.stallion-api.run\n'
            'Do not distribute developer profiles or saved account credentials.\n')
    print(target)
PY
