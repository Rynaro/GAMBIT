# GAMBIT

**The ControlCenter where you equip the Eidolons.**

GAMBIT completes the Final Fantasy lineage in the Eidolons ecosystem:

| Layer | Name | FF source | What it does |
|---|---|---|---|
| **Agents** | [Eidolons](https://github.com/Rynaro/eidolons) | FF4/9/13/16 — summoned spirits | The roster of AI agents (ATLAS, SPECTRA, APIVR-Δ, IDG, FORGE, VIGIL) |
| **Runtime harness** | [Junction](https://github.com/Rynaro/Junction) | FF8 — GF junction system | In-process MCP harness for plans, reasoning, verification |
| **ControlCenter** | **GAMBIT** | FF7 — orbs slotted into equipment for abilities and summons | Desktop app that equips Eidolons into projects, watches drift, streams sync |

*Eidolons answer the call. Junction is where they bind. GAMBIT is where you equip them.*

---

## What GAMBIT does

GAMBIT is a cozy, modern desktop ControlCenter built with Tauri 2 + React 18 + Vite. It reads your `eidolons.yaml` / `eidolons.lock` / `.eidolons/*/install.manifest.json`, watches them for drift, streams `sync` / `upgrade` / `doctor` output into polished log panes, and stays out of your way with a ⌘K-spined power surface.

Watches `eidolons.lock` and surfaces drift within a second.

The primary verb is **equip** — slot Eidolons into your project the way FF7's materia menu is where you slot summon orbs into your party's equipment.

---

## Status

### v0.0.1 — scaffold-only

This release establishes the project scaffold, brand-identity-as-config infrastructure, and a window that opens with a branded sidebar shell. The full v0.1 MVP (5 smoke-tests, live sync streaming, file-watching, ⌘K palette) is downstream work.

See [CHANGELOG.md](CHANGELOG.md) for the full release history and upcoming milestones.

---

## Getting started

### Prerequisites

- [Rust](https://rustup.rs/) (stable, 1.77+)
- [Node.js](https://nodejs.org/) (22+)
- [pnpm](https://pnpm.io/) (10.x — do not use pnpm 11)
- [Tauri CLI prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS

### Install dependencies

```bash
pnpm install
```

### Development

```bash
pnpm tauri dev
```

### Build

```bash
pnpm tauri build
```

---

## Rebranding

The project identity lives in a single source-of-truth file: [`brand.toml`](brand.toml).

Every derived file — `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src/lib/brand.ts`, `src-tauri/src/brand.rs`, `README.md` headings — is regenerated from `brand.toml` by the rebrand script. **Do not edit those files by hand.**

To rename the project:

```bash
./scripts/rebrand.sh NEWNAME
```

Example:

```bash
./scripts/rebrand.sh MAGICITE
```

The script will:
1. Refuse if the working tree has uncommitted changes.
2. Prompt for confirmation (or pass `--yes` to skip).
3. Rewrite `brand.toml` with the new identity.
4. Regenerate `src/lib/brand.ts` and `src-tauri/src/brand.rs`.
5. Patch `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.
6. Replace name references in `README.md` and `CHANGELOG.md`.
7. Stage all changes and print a `git diff --stat` summary.

Review with `git diff` and commit when satisfied.

---

## Project structure

```
materia/
├── brand.toml              # single source of truth for project identity
├── scripts/rebrand.sh      # regenerates all derived identity files
├── src/                    # React 18 + TypeScript frontend
│   ├── lib/brand.ts        # derived from brand.toml
│   ├── components/         # Sidebar, MainPane
│   └── styles/global.css   # dark-mode-first design tokens
├── src-tauri/              # Rust / Tauri 2 backend
│   ├── src/brand.rs        # derived from brand.toml
│   ├── cli.pin.toml        # pinned eidolons CLI version + SHA
│   └── resources/          # placeholder for bundled CLI tarball
└── .github/workflows/      # CI: lint + typecheck + cargo check
```

---

## License

MIT — see [LICENSE](LICENSE).
