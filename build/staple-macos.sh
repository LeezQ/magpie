#!/bin/bash
# Source this helper from the release packager. Retry only the observed CloudKit
# transport failure, never a rejected/missing ticket or invalid local signature.
# Both app and DMG stapling use the same bounded policy; validate stays mandatory.
staple_macos() {
    # Validation also contacts CloudKit. Give each operation its own bounded
    # retry budget; a successful staple must never bypass validation.
    apple_ticket_action staple "$1" "$2" || return $?
    apple_ticket_action validate "$1" "$2"
}

apple_ticket_action() {
    local action=$1 artifact=$2 log=$3 attempt=1 status
    while :; do
        if xcrun stapler "$action" "$artifact" > "$log" 2>&1; then
            cat "$log"
            return 0
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
