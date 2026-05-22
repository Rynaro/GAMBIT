# GAMBIT v0.3.0 Roadmap — "Eidolon Sessions"

> Implementation roadmap for the v0.3.0 milestone: **interact with the Eidolons
> by running `claude-code` from inside GAMBIT, capture its IO, and render it
> cozily — centered on the Eidolon, not on the terminal.**
>
> Produced by an Eidolons-cortex **TRANCE** chain: `ATLAS → FORGE → SPECTRA → roadmap`.
> Status: **planned** — no implementation has started. This document sequences it.

---

## 1 — What v0.3.0 delivers

GAMBIT v0.2 can only fire one-shot `eidolons` CLI verbs (sync / doctor / upgrade /
mcp). It cannot *converse* with an Eidolon. v0.3 adds a **Sessions** surface:

- Pick a project Eidolon from the Roster → launch a **session**.
- Each turn runs `claude` headlessly (`-p --output-format stream-json`), the
  Eidolon's persona injected as the system prompt.
- The NDJSON event stream is parsed and rendered as Eidolon-themed cards —
  assistant text, tool-use chips, collapsible thinking, a cost/turns/duration
  result card — with a raw-NDJSON debug toggle.
- `claude-code` is the **first and only** host tool in v0.3; the design leaves a
  clean `CursorAdapter` seam for later.

---

## 2 — Provenance (the TRANCE chain)

| Phase | Eidolon | Artifact |
|-------|---------|----------|
| Research (codebase) | **ATLAS** | `.atlas/scout-report.md`, `.atlas/mission.md` — 22 FINDINGs, `path:line` anchored |
| Research (external) | research branch | claude-code CLI capability report (verified vs. official docs) |
| Validate (architecture) | **FORGE** | 6 decisions, reversal conditions, 7-item risk list — embedded in §3 below |
| Plan + sharpen | **SPECTRA** | `.spectra/plans/v0-3-0-eidolon-sessions.yaml` + spec (8 stories, gates) — confidence 88% |
| Roadmap | orchestrator | **this document** |

---

## 3 — Architecture decisions (FORGE — fixed inputs)

| # | Decision | Verdict | Conf. |
|---|----------|---------|-------|
| D1 | Transport | Headless `claude -p --output-format stream-json` over **piped stdio. No PTY.** Custom parsed UI. | HIGH |
| D2 | Session model | **Stateless per-turn `--resume`.** A session = UUID + transcript + status; the process is an ephemeral per-turn detail. Registry keyed by UUID. | HIGH |
| D3 | Integration | **Rust spawns `claude` directly**, parses NDJSON with `serde_json`. No SDK sidecar. Interactive permission-prompt MCP deferred to v0.4. | HIGH |
| D4 | Eidolon mapping | Inject `.eidolons/<name>/agent.md` via `--append-system-prompt`. **Run *without* `--bare`.** `allowed-tools` front-matter → `--allowedTools`. | MED-HIGH |
| D5 | UI & multiplicity | Dedicated **Sessions route**; backend registry is multi-capable; v0.3 UI is **single active session** (tabs → v0.4). Launch from a corrected Roster route. | HIGH |
| D6 | Backend shape | New `session.rs` runner; extract a minimal shared `spawn_core`. **Do not** block v0.3 on retrofitting the 5 one-shot verbs. | MED-HIGH |

**Load-bearing constraint — the `--bare` do-not.** `--bare` would strip *both*
keychain/OAuth auth *and* subagent/skill discovery. The persona is delivered via
`--append-system-prompt` precisely so `--bare` is never needed. Any future PR that
adds `--bare` "for cleaner scripted calls" breaks auth and the Eidolons' skills —
this is a tracked do-not (FORGE R4).

**Risk register (FORGE R1–R7)** — mapped to mitigating stories in §6.

---

## 4 — The 8 stories & dependency DAG

```
        ┌─ S1 spawn_core + host resolver ─┐
        │                                 ├─ S2 ClaudeCodeAdapter ─┐
   (none)│                                 │  (NDJSON + flags)      │
        └─ S3 agent.md loader ─────────────┘                        │
                       │                                            ▼
                       │                          S4 SessionRegistry + start/send
                       │                                            │
                       │                          S5 auth status + cancel
                       │                                            │
                       │                          S6 useSession hook + types
                       │                                            │
                       │                          S7 Sessions route + transcript UI
                       │                                            │
                       └───────────────────────►  S8 Roster launch point + palette
```

| ID | Story | Depends | Score | FORGE risk |
|----|-------|---------|-------|-----------|
| S1 | `spawn_core` extraction + `find_host_tool` resolver | — | 3 | R7 |
| S2 | `ClaudeCodeAdapter` — flag construction + NDJSON parser | S1 | 6 | R7, D4 |
| S3 | `agent.md` front-matter loader (project Eidolons) | — | 5 | R5 |
| S4 | `SessionRegistry` + `start_session` / `send_turn` | S1, S2 | 9 | R6 |
| S5 | `claude_auth_status` + `cancel_session` | S4 | 3 | R2, R3 |
| S6 | `useSession` hook + `session.types.ts` | S4, S5 | 6 | — |
| S7 | Sessions route + transcript UI components | S6 | 8 | R1 |
| S8 | Corrected Roster launch point + ⌘K entry | S3, S7 | 6 | — |

Milestone effort ≈ **46 points**. Full GIVEN/WHEN/THEN, IPC contract, and
per-story gates: `.spectra/plans/v0-3-0-eidolon-sessions.yaml`.

---

## 5 — Resolved open items

SPECTRA surfaced four `[GAP]`/`[DISPUTED]` items; orchestrator rulings:

| Item | Ruling |
|------|--------|
| **GAP-1** — `uuid` crate absent from `Cargo.toml` | **Add the `uuid` crate** (`features = ["v4"]`). Hand-rolling a v4 UUID is not worth it; this is a justified, standard, ~0-risk dependency. Belongs to **S4**. |
| **GAP-2** — claude-code flag names unverified vs. an installed binary | **S2 acceptance gate:** APIVR-Δ runs `claude --help` first and reconciles every flag (`--append-system-prompt`, `--include-partial-messages`, `--allowedTools`, `--session-id`, `--resume`, `--permission-mode`). If a name differs, the adapter is the single point of change. |
| **DISPUTED-1** — Roster: project-only vs. project + global toggle | **Project-only for v0.3.** The global nexus catalog returns in v0.4 if wanted. |
| **GAP-3** — `shared_dispatch: true` semantics | **Deferred to v0.4.** v0.3 launches exactly one Eidolon per session. |

FORGE R4 (the `--bare` do-not) and R5 (persona-fidelity of `--append-system-prompt`
vs. the native subagent) are both covered: R4 is a spec-level do-not; R5 is retired
early because **S2 + S3 land in Phase 1**, validating D4 before any UI is built.

---

## 6 — Implementation waves (APIVR-Δ delegation plan)

Each story = **one APIVR-Δ delegation**. TRANCE G4 grants worktree isolation for
independent tracks. The DAG yields **one genuinely parallel wave** (W1); the rest
is a sequential vertical slice — backend → hook → UI → launch — and the roadmap
states that honestly rather than faking fan-out.

### Wave W1 — Phase 1 foundations · **parallel, 2 worktrees**
> Validates D6 (`spawn_core` boundary) and the front-matter contract early.

- **S1** → APIVR-Δ, `isolation: worktree`. `spawn_core.rs` + `binary::find_host_tool`. v0.2 verbs untouched.
- **S3** → APIVR-Δ, `isolation: worktree`. `lib/eidolonRoster.ts` + `eidolon.types.ts`; parse `agent.md` front-matter (do **not** use `stripFrontMatter`).
- **Gate:** each `make ci` green; S1 adds the first Rust unit test (`find_host_tool` resolves a PATH binary) — flag as a new pattern.

### Wave W2 — Phase 1 adapter · sequential (needs S1)
- **S2** → APIVR-Δ. `ClaudeCodeAdapter`: `build_args(...)` + `parse_line(...)`. Reconcile flags vs. `claude --help` (GAP-2). Test asserts **`--bare` never appears** in any arg path.
- *Optional optimisation:* the `claude_auth_status` half of **S5** depends only on S1 (host resolver), not S4 — it may be pulled forward into W2 as a second worktree. Left bundled in S5 by default; APIVR-Δ may split it if convenient.

### Wave W3 — Phase 2 backend core · sequential (needs S1+S2) · **highest risk**
- **S4** → APIVR-Δ. `SessionRegistry` (`Mutex<HashMap<Uuid, SessionHandle>>`), `start_session`, `send_turn`, the 3 `session-*` events. Add the `uuid` crate (GAP-1). **R6 dual-finalize:** a turn completes on the `result` event *or* clean process exit.
- Score 9, concurrency + process lifecycle — **VIGIL contingency armed** (see §7).
- **Gate:** `make ci` + manual smoke — `start_session` against a real `.eidolons` Eidolon emits `init` … `result`.

### Wave W4 — Phase 2 lifecycle · sequential (needs S4)
- **S5** → APIVR-Δ. `claude_auth_status` (pre-flight, exit 0/1) + `cancel_session` (SIGKILL). Document mid-turn kill as an accepted v0.3 limitation in the `session.rs` header.

### Wave W5 — Phase 3 hook · sequential (needs S4+S5)
- **S6** → APIVR-Δ. `useSession` (modelled on `useSync`; non-terminal alive state) + permissive `session.types.ts`. Tests cover both turn-complete paths (`result` and clean-exit).

### Wave W6 — Phase 3 UI · sequential (needs S6)
- **S7** → APIVR-Δ. `sessions` route (4 touch-points), transcript components, **R1** pre-launch permission-mode picker + allow-list abort warning, auth gate.

### Wave W7 — Phase 4 launch point · sequential (needs S3+S7)
- **S8** → APIVR-Δ. Correct `RosterRoute` to read project Eidolons, add per-row Launch, wire ⌘K `nav:sessions`.

### Wave W8 — Closeout · IDG
- **IDG** documents v0.3.0: `CHANGELOG.md` `[Unreleased]` → `[0.3.0]`; an ADR for the session architecture (D1–D6 + reversal conditions); `README.md` updates (Commands table gains *Sessions*; Status section; "What GAMBIT does").
- Version bump 0.2.0 → 0.3.0 via the brand/release path.

---

## 7 — Verification & VIGIL contingency

- **Per wave:** `make ci` (Biome lint + `tsc --noEmit` + `cargo check`) green; the story's P0 contract checks (every `#[tauri::command]` registered + `.manage()`-d; TS `invoke` name/args match Rust) pass.
- **After W3 and W7:** manual smoke against a real installed `claude` and a real `.eidolons` Eidolon.
- **VIGIL contingency:** S4 is the highest-risk story (concurrency, process lifecycle, the R6 dropped-`result` edge case). If APIVR-Δ's Verify phase exhausts its bounded Reflect loop (3 same-category failures), escalate via the `failed-attempt-recovery` chain → **VIGIL** root-causes → APIVR-Δ applies the verified patch. v0.2 used VIGIL twice this way; treat it as expected, not exceptional.

---

## 8 — Definition of Done (v0.3.0)

1. From the Roster, the user launches any project Eidolon as a session into the Sessions route.
2. A turn runs `claude` headless, streams parsed NDJSON, and renders init → assistant/tool/thinking → result cards.
3. Multi-turn within a session works via `--resume`.
4. Pre-flight `claude auth status` gates launch; a logged-out state is shown clearly, never an opaque failure.
5. Permission mode is chosen before launch; the allow-list abort risk is surfaced honestly.
6. Cancel kills the active turn.
7. Raw-NDJSON debug toggle present.
8. `make ci` green; the smoke flow in §7 passes.

---

## 9 — Explicitly deferred to v0.4+

PTY / interactive TUI · Node/Python SDK sidecar · multi-session tabs (backend
registry is already multi-capable) · interactive `--permission-prompt-tool` MCP
approval · `CursorAdapter` and other host tools (the `ClaudeCodeAdapter` seam is
ready) · `shared_dispatch` semantics · graceful SIGINT cancel (needs the `nix`
dep) · retrofitting the 5 one-shot verbs onto `spawn_core`.

---

## 10 — At a glance

| Wave | Stories | Parallelism | Phase | Points |
|------|---------|-------------|-------|--------|
| W1 | S1, S3 | 2 worktrees | 1 | 8 |
| W2 | S2 | sequential | 1 | 6 |
| W3 | S4 | sequential · VIGIL armed | 2 | 9 |
| W4 | S5 | sequential | 2 | 3 |
| W5 | S6 | sequential | 3 | 6 |
| W6 | S7 | sequential | 3 | 8 |
| W7 | S8 | sequential | 4 | 6 |
| W8 | IDG closeout | — | — | — |

**Total ≈ 46 points across 7 build waves + 1 doc wave.**
