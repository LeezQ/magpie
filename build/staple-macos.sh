#!/bin/bash
# Source this helper from the release packager. Retry only the observed CloudKit
# transport failure, never a rejected/missing ticket or invalid local signature.
# Both app and DMG stapling use the same bounded policy; validate stays mandatory.
staple_macos() {
    local artifact=$1 log=$2 attempt=1 status
    while :; do
        if xcrun stapler staple "$artifact" > "$log" 2>&1; then
            cat "$log"
            xcrun stapler validate "$artifact"
            return $?
        else
            status=$?
        fi
        cat "$log" >&2
        # Error 68 alone can mean other CloudKit failures. Require the actual
        # NSURLErrorDomain connection-lost diagnostic captured on both CI runs.
        if [[ $status -ne 68 ]] || ! grep -Eq 'NSURLErrorDomain Code=-1005' "$log" || [[ $attempt -ge 5 ]]; then
            return "$status"
        fi
        printf 'Apple ticket connection lost; retry %d/5 in %d seconds\n' "$((attempt + 1))" "$((attempt * 15))" >&2
        sleep "$((attempt * 15))"
        attempt=$((attempt + 1))
    done
}
