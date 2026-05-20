# scripts/

Helper scripts for the MATERIA project.

| Script | Purpose |
|---|---|
| `rebrand.sh` | Rename the project. Rewrites `brand.toml` and regenerates all derived identity files. Usage: `./scripts/rebrand.sh [--yes] NEWNAME`. |

## rebrand.sh

The renamability spine. Single call rewrites every file that carries the project identity:

- `brand.toml` — identity name, slug, bundle_id, domain, GitHub repo, Homebrew tap
- `src/lib/brand.ts` — regenerated TypeScript const object
- `src-tauri/src/brand.rs` — regenerated Rust const block
- `package.json` — name + productName fields
- `src-tauri/tauri.conf.json` — productName, identifier, mainBinaryName
- `src-tauri/Cargo.toml` — [package].name
- `README.md` — name occurrences in heading lines
- `CHANGELOG.md` — name occurrences in heading lines

The script refuses to run if the working tree has uncommitted changes. Stages the changes on success but does NOT auto-commit — review with `git diff --staged` first.

## Adding a new script

- Keep scripts bash 3.2 compatible: no `${var,,}`, no associative arrays, no `mapfile`, no `&>>`.
- Use `#!/bin/sh` for portability unless you need a bash-specific feature.
- All output goes to stdout; errors and warnings go to stderr.
- Exit 0 on success, non-zero on failure.
