package stallionx

import "sync/atomic"

var requiredUser atomic.Bool

// EnableRequiredUser is enabled by the commercial application bootstrap, not
// by packages embedded independently in tests or other hosts.
func EnableRequiredUser() { requiredUser.Store(true) }

func UserRequired() bool { return requiredUser.Load() }
