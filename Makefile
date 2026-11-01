# The recipes (clean's rm -rf too) name paths relative to the working
# folder, so they run only in magpie's own, known by its go.mod: run from
# another one (make -f path/to/Makefile) they would act there. make -C
# works. go.mod is read relative to the working folder, so a path with
# spaces (or a symlinked Makefile) changes nothing.
ifneq ($(shell sed -n 's/^module //p' go.mod 2>/dev/null),github.com/yetone/magpie)
  $(error run make in magpie's folder (make -C path/to/magpie), not in $(CURDIR))
endif

# A tag may hold $, ( or `, which the shell lines below would run: the
# version keeps only what a version is spelled with.
VERSION ?= $(or $(shell git describe --tags --always --dirty 2>/dev/null | tr -cd 'A-Za-z0-9._+-'),dev)
LDFLAGS  = -s -w -X main.version=$(VERSION)
TAGS     = production
TARGETS  = darwin/arm64 darwin/amd64 linux/amd64 linux/arm64 windows/amd64 windows/arm64 android/arm64

# The GUI links the platform webview through cgo, so it is built natively.
# `nogui` builds the terminal-only magpie, which cross-compiles anywhere.
# macOS 12 is the oldest Go (1.25 and later) runs on; Info.plist says so too.
ifeq ($(shell uname -s),Darwin)
  export CGO_CFLAGS  = -mmacosx-version-min=12.0
  export CGO_LDFLAGS = -mmacosx-version-min=12.0
endif
# On Linux, GTK 3 and WebKitGTK 4.1: older distributions have them, where
# Wails' default GTK 4 and WebKitGTK 6 would leave them out.
ifeq ($(shell uname -s),Linux)
  TAGS += gtk3
endif
# Termux uses Android's libc and has no desktop webview. Keep the web UI
# and terminal commands, without linking GTK or Wails.
ifeq ($(shell go env GOOS),android)
  TAGS = nogui
endif

.PHONY: build cli install test test-ui app icons icons-magpie release release-cli release-windows release-linux clean dev dev-once
.PHONY: console

# Rebuild the isolated account UI from the sibling StallionX Web source.
# Generated assets are checked in, so normal upstream Go builds need no Node.
console:
	node desktop-console/build.mjs

# StallionX, a fork of magpie: the binary is `stallionx` and the Mac app
# StallionX.app (internal/brand), so both can be installed side by side.
BIN = stallionx
APP = StallionX.app

build:
	go build -tags "$(TAGS)" -trimpath -ldflags="$(LDFLAGS)" -o $(BIN) .

cli:
	CGO_ENABLED=0 go build -tags nogui -trimpath -ldflags="$(LDFLAGS)" -o $(BIN) .

install: build
	@mkdir -p "$(HOME)/.local/bin"
	@cp $(BIN) "$(HOME)/.local/bin/$(BIN)"

test:
	go vet -tags "$(TAGS)" ./... && go test -tags "$(TAGS)" ./...

# The browser regressions under internal/gui/tests: the real pages in
# Playwright's Chromium and WebKit; see internal/gui/tests/README.md.
UI_TESTS = $(wildcard internal/gui/tests/*.test.cjs)
# Files are independent and run in parallel; 1 diagnoses a flaky one.
UI_TEST_CONCURRENCY ?= 2

test-ui:
	@test -n "$(UI_TESTS)" || { echo "no GUI tests found under internal/gui/tests" >&2; exit 1; }
	node --test --test-concurrency=$(UI_TEST_CONCURRENCY) $(UI_TESTS)

# macOS bundle: menu bar app with no Dock icon (LSUIElement).
app: build
	@rm -rf $(APP)
	@mkdir -p $(APP)/Contents/MacOS $(APP)/Contents/Resources
	@cp $(BIN) $(APP)/Contents/MacOS/$(BIN)
	@cp build/darwin/magpie.icns $(APP)/Contents/Resources/magpie.icns
	@cp build/darwin/Assets.car $(APP)/Contents/Resources/Assets.car
	@cp THIRD_PARTY_NOTICES $(APP)/Contents/Resources/THIRD_PARTY_NOTICES
	@cp LICENSE $(APP)/Contents/Resources/LICENSE
	@sed 's/@VERSION@/$(VERSION)/' build/darwin/Info.plist > $(APP)/Contents/Info.plist
	@echo "  $(APP)"

# StallionX's icons, all from build/icon/stallionx*.svg (needs rsvg-convert;
# on a Mac iconutil and Xcode's actool). icons-magpie is upstream's bird,
# kept so the recipe still merges, and no longer what ships.
icons:
	@build/icon/stallionx-icons.sh

icons-magpie:
	@go run build/icon/gen.go tray internal/gui/tray.png
	@go run build/icon/gen.go tray-flap internal/gui/trayflap
	@# Windows draws an app's icon to the edges of its square: the exe's
	@# icon group (build/windows/winres.json) and the tray's .ico
	@for s in 16 20 24 32 40 48 64 128 256; do \
		go run build/icon/gen.go win $$s build/windows/icon-$$s.png; \
	done
	@go run build/icon/gen.go win-ico internal/gui/icon-windows.ico
	@go run build/icon/gen.go app 1024 internal/gui/icon-1024.png
	@go run build/icon/gen.go app 256 internal/gui/icon-256.png
	@rm -rf build/darwin/magpie.iconset && mkdir -p build/darwin/magpie.iconset
	@for s in 16 32 128 256 512; do \
		go run build/icon/gen.go app $$s build/darwin/magpie.iconset/icon_$${s}x$${s}.png; \
		go run build/icon/gen.go app $$((s*2)) build/darwin/magpie.iconset/icon_$${s}x$${s}@2x.png; \
	done
	@iconutil -c icns build/darwin/magpie.iconset -o build/darwin/magpie.icns && rm -rf build/darwin/magpie.iconset
	@# macOS 26 draws the Dock icon from AppIcon.icon, light and dark (Xcode 26's actool);
	@# the compiled Assets.car is kept in the tree so a release needn't have it
	@go run build/icon/gen.go glyph 1024 build/darwin/AppIcon.icon/Assets/magpie.png
	@rm -rf build/darwin/actool && mkdir -p build/darwin/actool
	@xcrun actool build/darwin/AppIcon.icon --compile build/darwin/actool --platform macosx \
		--minimum-deployment-target 11.0 --app-icon AppIcon --output-partial-info-plist build/darwin/actool/partial.plist >/dev/null
	@mv build/darwin/actool/Assets.car build/darwin/Assets.car && rm -rf build/darwin/actool

release: clean build
	@mkdir -p dist
	@cp $(BIN) dist/$(BIN)-$(shell go env GOOS)-$(shell go env GOARCH)
	@$(MAKE) --no-print-directory release-cli

release-cli:
	@mkdir -p dist
	@for t in $(TARGETS); do \
		os=$${t%/*}; arch=$${t#*/}; ext=""; [ $$os = windows ] && ext=.exe; \
		echo "  $$os/$$arch (cli)"; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -tags nogui -trimpath -ldflags="$(LDFLAGS)" -o dist/$(BIN)-cli-$$os-$$arch$$ext . || exit 1; \
	done

# The desktop app for Windows: the system WebView2 needs no cgo, so both
# arches cross-compile. Linked as a GUI program (no console window), with
# the icon, version and a DPI-aware manifest from build/windows. It carries
# magpie.com, the console program a terminal runs for `magpie` and waits
# for, which it writes beside itself (internal/update/com.go, #3737).
# The launcher is built without the commit stamped in (-buildvcs=false):
# magpie.com is written again whenever its bytes differ, and with the
# commit in them every release wrote a new one though the launcher was the
# same (TestLauncherSameAtEveryCommit).
WINVER = $(shell echo $(VERSION) | sed -E 's/^v//; s/[^0-9.].*//')
release-windows:
	@mkdir -p dist
	@go run github.com/tc-hib/go-winres@v0.3.3 make --in build/windows/winres.json --arch amd64,arm64 --out rsrc \
		--file-version "$(or $(WINVER),0.0.0)" --product-version "$(or $(WINVER),0.0.0)"
	@for arch in amd64 arm64; do \
		echo "  windows/$$arch (app)"; \
		CGO_ENABLED=0 GOOS=windows GOARCH=$$arch go build -trimpath -buildvcs=false -ldflags="-s -w" -o internal/update/launcher-$$arch.com ./internal/update/launcher || exit 1; \
		CGO_ENABLED=0 GOOS=windows GOARCH=$$arch go build -tags production,comlauncher -trimpath -ldflags="$(LDFLAGS) -H windowsgui" -o dist/$(BIN)-windows-$$arch.exe . || exit 1; \
	done; rm -f rsrc_windows_*.syso internal/update/launcher-*.com

# The desktop app for Linux links GTK 3 and WebKitGTK 4.1 through cgo, so it
# is built natively, one arch per machine.
release-linux:
	@mkdir -p dist
	@echo "  linux/$(shell go env GOARCH) (app)"
	@go build -tags "$(TAGS)" -trimpath -ldflags="$(LDFLAGS)" -o dist/$(BIN)-linux-$(shell go env GOARCH) .

clean:
	rm -rf $(BIN) $(BIN).exe $(APP) magpie magpie.exe magpie.app dist rsrc_windows_*.syso internal/update/launcher-*.com

# Development: the UI is served from internal/gui/assets and the window
# reloads itself when a file there is saved. With fswatch installed, the
# windows stay up and a Go change rebuilds and restarts only the backend
# behind them (build/dev.sh); without it, dev-once runs the app as one
# process. Uses its own ports so a running magpie keeps serving the agents.
DEV_ADDR ?= 127.0.0.1:3426
DEV_UI ?= 127.0.0.1:3427
DEV_BACKEND ?= 127.0.0.1:3428
DEV_CONTROL ?= 127.0.0.1:3429
# Compile with the developer's normal Go cache, then run with isolated homes.
dev: dev-once

dev-once:
	@go build -tags dev -o stallionx-dev .
	@go run build/sandbox.go ./stallionx-dev app
