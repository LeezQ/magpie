#!/bin/bash
# Offline behavioral tests: shell functions replace xcrun and sleep, so no
# credentials, real Apple requests, signatures or wall-clock delays are involved.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
source "$ROOT/build/staple-macos.sh"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
xcrun() {
    if [[ $2 == validate ]]; then
        validates=$((validates + 1))
        if [[ $mode == validation-transient && $validates -ge 3 ]]; then return 0; fi
        if [[ $mode == validation-* ]]; then
            printf 'NSURLErrorDomain Code=-1005 connection lost\n'
            return 68
        fi
        return "$validation_status"
    fi
    calls=$((calls + 1))
    if [[ $mode == transient && $calls -ge 3 ]]; then return 0; fi
    if [[ $mode == success || $mode == validation-* ]]; then return 0; fi
    if [[ $mode != permanent ]]; then printf 'NSURLErrorDomain Code=-1005 connection lost\n'; fi
    return 68
}
sleep() { waits=$((waits + 1)); }
check() {
    mode=$1 validation_status=$2 calls=0 validates=0 waits=0
    local result=0
    staple_macos '/fixture with spaces/app.dmg' "$STAGE/log" || result=$?
    [[ $result -eq $3 && $calls -eq $4 && $validates -eq $5 && $waits -eq $6 ]] || {
        printf 'FAIL %s: status=%s calls=%s validations=%s waits=%s\n' "$mode" "$result" "$calls" "$validates" "$waits" >&2
        exit 1
    }
}
check transient 0 0 3 1 2
check permanent 0 68 1 0 0
check exhausted 0 68 5 0 4
check success 65 65 1 1 0
check validation-transient 0 0 1 3 2
check validation-exhausted 0 68 1 5 4
printf 'PASS: staple/validate transient recovery, permanent rejection and bounded retries\n'
