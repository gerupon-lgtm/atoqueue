# Task 1 report - Bootstrap the monorepo and quality gates

## Modified files

- Added the pnpm workspace root, TypeScript base configuration, lint/format/test configuration, and CI workflow.
- Added Web, API, domain, and contracts package scaffolding.
- Added the required domain schema-version and API health-route smoke tests.
- Updated `docs/tasks.md` to record T-001 as complete.

## Failed-test confirmation

Before implementing the source modules, `pnpm test` failed because the two required tests could not resolve `packages/domain/src/index.ts` and `apps/api/src/server.ts`. This confirmed that both tests were active before the implementation.

## Verification

- `pnpm lint` - passed
- `pnpm typecheck` - passed
- `pnpm test` - passed (2 files, 2 tests)
- `pnpm build` - passed

## Commit

Created with `chore: bootstrap atoqueue workspace`; use `git rev-parse HEAD` to obtain the resulting commit ID.

## Concerns

Vitest 3 emits a non-failing workspace-file deprecation warning for the specified test command; the configuration remains intentionally compatible with that command.

## Fix round 1

- Confirmed that the repository has no configured Git remotes, so the initial commit had not been pushed from this checkout.
- Excluded `.superpowers/brainstorm/` from version control and removed its existing tracked runtime artifacts before amending the initial commit.
- Added the required empty environment-variable names to `.env.example` without recording any values.
- Added `pnpm exec prettier --check .` as an independent CI quality-gate step without changing the required root scripts.
- Replaced the non-semver pnpm metadata shorthand with an exact pnpm 10 release so Corepack and the required `pnpm exec` command can run reliably.
- Added `.prettierignore` for generated agent runtime artifacts so CI checks only versioned project sources and documentation.

### Verification

- `pnpm lint` - passed
- `pnpm typecheck` - passed
- `pnpm test` - passed (2 files, 2 tests)
- `pnpm build` - passed
- `pnpm exec prettier --check .` - passed

## Fix round 2

- Restored the root manifest's required `packageManager: "pnpm@10"` declaration.
- Kept the package-manager compatibility warning in this report rather than changing the required manifest declaration.

### Verification

- `pnpm lint` - passed
- `pnpm typecheck` - passed
- `pnpm test` - passed (2 files, 2 tests)
- `pnpm build` - passed
- `pnpm exec prettier --check .` - passed
