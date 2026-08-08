# pnpm 10 dependency-build allowlist

The OCI release wrapper intentionally runs pnpm 10.20.0. That version blocks dependency lifecycle scripts by default. The production API needs Argon2's native install script, so the workspace's `onlyBuiltDependencies` list must retain `argon2`.

`allowBuilds` is also kept for newer local pnpm clients. It does not replace `onlyBuiltDependencies` for the production pnpm 10.20.0 runtime. When intentionally upgrading the server runtime to a pnpm release that supports `allowBuilds`, verify a clean production install before removing the legacy list.
