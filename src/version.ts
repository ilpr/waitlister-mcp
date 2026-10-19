// The version this server reports to hosts and in its API identification
// headers. A constant rather than a package.json read, so the tool layer has no
// Node-only dependency. test/tools.test.mjs fails if this drifts from
// package.json, which keeps the old "can never drift" guarantee.
export const VERSION = "1.5.0";
