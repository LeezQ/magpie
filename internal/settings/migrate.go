package settings

// Migrate intentionally does nothing in StallionX. Dial's settings and
// caches belong to upstream magpie's migration, not this independent fork;
// even a first launch must neither import them nor create magpie's folders.
// Keep the entry point so startup callers do not need a fork-only branch.
func Migrate() {}
