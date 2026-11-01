#!/bin/bash
# Package StallionX on a native macOS runner without touching a developer's
# local binary or StallionX.app. Usage: build/release-macos.sh X.Y.Z
# SIGN_MACOS defaults to false; unsigned artifacts are explicitly named as such.
# Signing requires all six APPLE_* variables checked below. Never enable tracing:
# certificate/password arguments must not appear in the build log.
set +x
set -euo pipefail
umask 077

fail() {
    printf 'release-macos: %s\n' "$*" >&2
    exit 1
}

[[ $# -eq 1 ]] || fail 'usage: build/release-macos.sh X.Y.Z'
VERSION=$1
[[ $VERSION =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] ||
    fail 'VERSION must be X.Y.Z, without a v prefix, suffix, or leading zeroes'
SIGN_MACOS=${SIGN_MACOS-false}
case "$SIGN_MACOS" in
    true|false) ;;
    *) fail 'SIGN_MACOS must be exactly true or false' ;;
esac

# Fail before compiling or creating a keychain when signing was requested but
# incomplete. Indirection checks presence without printing any secret values.
if [[ $SIGN_MACOS == true ]]; then
    for name in APPLE_CERTIFICATE_P12_BASE64 APPLE_CERTIFICATE_PASSWORD \
        APPLE_SIGNING_IDENTITY APPLE_ID APPLE_TEAM_ID APPLE_APP_PASSWORD; do
        [[ -n ${!name:-} ]] || fail "missing required signing variable: $name"
    done
fi

[[ $(uname -s) == Darwin ]] || fail 'a native macOS runner is required'
for tool in go ditto hdiutil plutil; do
    command -v "$tool" >/dev/null || fail "required tool not found: $tool"
done
ARCH=$(go env GOARCH)
[[ $(go env GOOS) == darwin && $ARCH == "$(go env GOHOSTARCH)" ]] ||
    fail 'Go must target the native macOS runner, not a cross-compilation target'
case "$ARCH" in
    arm64|amd64) ;;
    *) fail "unsupported macOS architecture: $ARCH" ;;
esac
if [[ $SIGN_MACOS == true ]]; then
    for tool in security codesign xcrun openssl; do
        command -v "$tool" >/dev/null || fail "required signing tool not found: $tool"
    done
    xcrun --find notarytool >/dev/null
    xcrun --find stapler >/dev/null
fi

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
DIST="$ROOT/dist"
NAME="StallionX-${VERSION}-macos-${ARCH}"
[[ $SIGN_MACOS == true ]] || NAME="$NAME-unsigned"
mkdir -p "$DIST"
# Refuse to replace a previous release, including a dangling symlink. A failed
# rebuild must not leave an old artifact looking like this invocation's result.
for extension in zip dmg; do
    [[ ! -e "$DIST/$NAME.$extension" && ! -L "$DIST/$NAME.$extension" ]] ||
        fail "output already exists: $DIST/$NAME.$extension"
done

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/stallionx-release.XXXXXX")
KEYCHAIN="$STAGE/signing.keychain-db"
KEYCHAIN_CREATED=false
SEARCH_LIST_CHANGED=false
ORIGINAL_KEYCHAINS=()

# EXIT also runs after failed builds, rejected notarizations, and handled signals.
# Restore the user's search list before deleting only our temporary keychain.
# Cleanup errors are logged and make an otherwise successful run fail as well.
cleanup() {
    local status=$?
    trap - EXIT HUP INT TERM
    if [[ $SEARCH_LIST_CHANGED == true ]]; then
        if ! security list-keychains -d user -s ${ORIGINAL_KEYCHAINS[@]+"${ORIGINAL_KEYCHAINS[@]}"}; then
            printf 'release-macos: failed to restore keychain search list\n' >&2
            status=1
        fi
    fi
    if [[ $KEYCHAIN_CREATED == true ]]; then
        if ! security delete-keychain "$KEYCHAIN"; then
            printf 'release-macos: failed to delete temporary signing keychain\n' >&2
            status=1
        fi
    fi
    if ! rm -rf "$STAGE"; then
        printf 'release-macos: failed to remove temporary staging directory\n' >&2
        status=1
    fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

APP="$STAGE/bundle/StallionX.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
# Mirror Makefile's production app recipe in our own staging area. make app
# deletes the checkout's app, and make clean also deletes unrelated dist files.
# Keep the deployment target aligned with Makefile and Info.plist (macOS 12).
(
    cd "$ROOT"
    CGO_ENABLED=1 CGO_CFLAGS='-mmacosx-version-min=12.0' \
        CGO_LDFLAGS='-mmacosx-version-min=12.0' \
        go build -tags production -trimpath \
        -ldflags="-s -w -X main.version=$VERSION" \
        -o "$APP/Contents/MacOS/stallionx" .
)
cp "$ROOT/build/darwin/magpie.icns" "$APP/Contents/Resources/magpie.icns"
cp "$ROOT/build/darwin/Assets.car" "$APP/Contents/Resources/Assets.car"
cp "$ROOT/LICENSE" "$APP/Contents/Resources/LICENSE"
cp "$ROOT/THIRD_PARTY_NOTICES" "$APP/Contents/Resources/THIRD_PARTY_NOTICES"
# VERSION has already been restricted to decimal components and dots, so it is
# safe in the replacement expression as well as the linker and output names.
sed "s/@VERSION@/$VERSION/g" "$ROOT/build/darwin/Info.plist" > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist"
chmod -R a+rX "$APP"

# Require an explicit Accepted result rather than relying solely on notarytool's
# process exit code. Reports stay in the private staging directory until cleanup.
notarize() {
    local artifact=$1
    local report=$2
    xcrun notarytool submit "$artifact" --keychain "$KEYCHAIN" \
        --keychain-profile stallionx-release --wait --output-format json > "$report"
    [[ $(plutil -extract status raw -o - "$report") == Accepted ]] ||
        fail 'Apple notarization was not Accepted; no release artifacts were published'
}

if [[ $SIGN_MACOS == true ]]; then
    # security emits one quoted path per line. Parse it without eval or word
    # splitting, preserving keychain names containing spaces. Capture the command
    # first so a failed read cannot silently become an empty original search list.
    search_list=$(security list-keychains -d user)
    while IFS= read -r line; do
        [[ -n $line ]] || continue
        if [[ $line =~ ^[[:space:]]*\"(.*)\"[[:space:]]*$ ]]; then
            ORIGINAL_KEYCHAINS+=("${BASH_REMATCH[1]}")
        else
            fail 'could not parse the existing keychain search list'
        fi
    done <<< "$search_list"

    KEYCHAIN_PASSWORD=$(openssl rand -hex 32)
    # Creation itself may add the keychain to the search list. Mark both before
    # the command so cleanup also restores the list after a partial failure.
    KEYCHAIN_CREATED=true
    SEARCH_LIST_CHANGED=true
    security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
    security set-keychain-settings -lut 21600 "$KEYCHAIN"
    security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
    SEARCH_LIST_CHANGED=true
    security list-keychains -d user -s "$KEYCHAIN" ${ORIGINAL_KEYCHAINS[@]+"${ORIGINAL_KEYCHAINS[@]}"}
    printf '%s' "$APPLE_CERTIFICATE_P12_BASE64" | base64 --decode > "$STAGE/certificate.p12"
    security import "$STAGE/certificate.p12" -k "$KEYCHAIN" \
        -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
        -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
    rm -f "$STAGE/certificate.p12"
    unset KEYCHAIN_PASSWORD APPLE_CERTIFICATE_P12_BASE64 APPLE_CERTIFICATE_PASSWORD

    # Store the notary credentials only in the disposable keychain. Do not use
    # or replace a profile in the developer's login/default keychain.
    xcrun notarytool store-credentials stallionx-release --keychain "$KEYCHAIN" \
        --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
        --password "$APPLE_APP_PASSWORD" >/dev/null
    unset APPLE_APP_PASSWORD

    # There is one executable and no nested frameworks in the app recipe. Sign
    # inside-out, explicitly selecting this keychain and the supplied identity.
    codesign --force --sign "$APPLE_SIGNING_IDENTITY" --keychain "$KEYCHAIN" \
        --options runtime --timestamp "$APP/Contents/MacOS/stallionx"
    codesign --force --sign "$APPLE_SIGNING_IDENTITY" --keychain "$KEYCHAIN" \
        --options runtime --timestamp "$APP"
    codesign --verify --deep --strict --verbose=2 "$APP"
    ditto -c -k --sequesterRsrc --keepParent "$APP" "$STAGE/notarization.zip"
    notarize "$STAGE/notarization.zip" "$STAGE/app-notarization.json"
    xcrun stapler staple "$APP"
    xcrun stapler validate "$APP"
    codesign --verify --deep --strict --verbose=2 "$APP"
fi

# Archive only the final, stapled app in signed mode. The DMG offers the usual
# drag-to-Applications install, and contains no certificates or notary reports.
ditto -c -k --sequesterRsrc --keepParent "$APP" "$STAGE/$NAME.zip"
mkdir -p "$STAGE/dmg"
ditto "$APP" "$STAGE/dmg/StallionX.app"
ln -s /Applications "$STAGE/dmg/Applications"
chmod 755 "$STAGE/dmg"
hdiutil create -volname StallionX -srcfolder "$STAGE/dmg" \
    -format UDZO -fs HFS+ "$STAGE/$NAME.dmg"
if [[ $SIGN_MACOS == true ]]; then
    codesign --force --sign "$APPLE_SIGNING_IDENTITY" --keychain "$KEYCHAIN" \
        --timestamp "$STAGE/$NAME.dmg"
    codesign --verify --strict --verbose=2 "$STAGE/$NAME.dmg"
    notarize "$STAGE/$NAME.dmg" "$STAGE/dmg-notarization.json"
    xcrun stapler staple "$STAGE/$NAME.dmg"
    xcrun stapler validate "$STAGE/$NAME.dmg"
    codesign --verify --strict --verbose=2 "$STAGE/$NAME.dmg"
fi
hdiutil verify "$STAGE/$NAME.dmg"

# Publish only after both packages have passed all checks. Nothing cleans dist
# or the developer's existing app, and the trap owns only this mktemp directory.
chmod 644 "$STAGE/$NAME.zip" "$STAGE/$NAME.dmg"
mv "$STAGE/$NAME.zip" "$DIST/$NAME.zip"
mv "$STAGE/$NAME.dmg" "$DIST/$NAME.dmg"
printf 'Created %s\nCreated %s\n' "$DIST/$NAME.zip" "$DIST/$NAME.dmg"
