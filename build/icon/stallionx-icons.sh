#!/usr/bin/env bash
# stallionx-icons.sh renders every icon StallionX ships from the SVGs beside
# it, in place of magpie's bird (gen.go draws that one and is kept for
# upstream merges, but no longer run). `make icons` runs this.
#
#   stallionx.svg         the mark: a white S on a black disc
#   stallionx-tray.svg    the menu bar's template image (alpha only)
#   stallionx-tile.svg    the macOS app tile, for magpie.icns
#   stallionx-glyph.svg   macOS 26's AppIcon.icon glyph layer
#   stallionx-square.svg  full-bleed, for a phone's home screen
#
# Needs rsvg-convert (brew install librsvg); on a Mac, iconutil and Xcode's
# actool for the .icns and Assets.car. File names that the build, the
# Info.plist and the embeds read stay magpie's (magpie.icns, icon.png) so
# nothing else has to follow; only what is in them is StallionX's.
set -euo pipefail
cd "$(dirname "$0")/../.." || exit 1

icon=build/icon
render() { rsvg-convert -w "$2" -h "$2" "$icon/$1.svg" -o "$3"; }

command -v rsvg-convert >/dev/null || { echo "rsvg-convert not found: brew install librsvg" >&2; exit 1; }

# the menu bar, 44px (22pt @2x); the flap that played on a click was the
# bird's wing, so it is one still frame now (the embed needs a file)
render stallionx-tray 44 internal/gui/tray.png
rm -f internal/gui/trayflap/*.png
cp internal/gui/tray.png internal/gui/trayflap/flap-01.png

# the window's and Windows' tray icon, Linux's desktop icon
render stallionx 64 internal/gui/icon.png
render stallionx 256 internal/gui/icon-256.png
render stallionx 1024 internal/gui/icon-1024.png

# the page's own icons (the web UI and a phone's home screen)
cp "$icon/stallionx.svg" internal/gui/assets/icons/favicon.svg
cp "$icon/stallionx-tray.svg" internal/gui/assets/icons/stallionx.svg
render stallionx-square 180 internal/gui/assets/icons/apple-touch-icon.png
render stallionx-square 512 internal/gui/assets/icons/icon-512.png

# Windows' .exe icon (build/windows/winres.json)
for s in 16 20 24 32 40 48 64 128 256; do
	render stallionx "$s" "build/windows/icon-$s.png"
done
# Upstream's Windows tray now selects a DPI-specific PNG from an ICO. Package
# the same branded images used by the executable, rather than its bird artwork.
python3 -I "$icon/stallionx-ico.py" build/windows internal/gui/icon-windows.ico

# macOS: the .icns before macOS 26, AppIcon.icon's compiled Assets.car on it
if [ "$(uname -s)" = Darwin ]; then
	set_dir=build/darwin/magpie.iconset
	rm -rf "$set_dir" && mkdir -p "$set_dir"
	for s in 16 32 128 256 512; do
		render stallionx-tile "$s" "$set_dir/icon_${s}x${s}.png"
		render stallionx-tile "$((s * 2))" "$set_dir/icon_${s}x${s}@2x.png"
	done
	iconutil -c icns "$set_dir" -o build/darwin/magpie.icns
	rm -rf "$set_dir"

	render stallionx-glyph 1024 build/darwin/AppIcon.icon/Assets/stallionx.png
	rm -f build/darwin/AppIcon.icon/Assets/magpie.png
	out=build/darwin/actool
	rm -rf "$out" && mkdir -p "$out"
	if xcrun actool build/darwin/AppIcon.icon --compile "$out" --platform macosx \
		--minimum-deployment-target 11.0 --app-icon AppIcon \
		--output-partial-info-plist "$out/partial.plist" >/dev/null; then
		mv "$out/Assets.car" build/darwin/Assets.car
	else
		echo "actool failed: Assets.car (macOS 26's Dock icon) not rebuilt" >&2
	fi
	rm -rf "$out"
fi
echo "  icons rendered from build/icon/stallionx*.svg"
