# ADR 0001 — Eidolon Session architecture

- **Status:** Accepted — implemented in v0.3.0
- **Date:** 2026-05-22
- **Context source:** TRANCE chain `ATLAS → FORGE → SPECTRA`; see `ROADMAP-v0.3.0.md`
  and `.spectra/plans/v0-3-0-eidolon-sessions.yaml`.

## Context

v0.2 GAMBIT could only fire one-shot bundled-`eidolons` CLI verbs. v0.3's goal:
let the user *interact* with an Eidolon — run `claude-code`, capture its IO, and
render it cozily, centered on the Eidolon. Six architecture decisions (D1–D6)
were deliberated by FORGE before any code was written. Each carries a reversal
condition — the signal that would make us revisit it.

## Decisions

### D1 — Transport: headless `stream-json` over piped stdio, no PTY

`claude` is run headless (`-p --output-format stream-json --verbose
--include-partial-messages`) over ordinary piped stdio. The NDJSON event stream
is parsed and rendered into a custom, Eidolon-themed UI.

*Rationale:* "Cozy and centered on the Eidolon" calls for a curated UI, not a
faithful reproduction of claude-code's own terminal. A PTY would render
claude-code's surface; a parsed event stream is the raw material for
Eidolon-centered cards. Headless mode is explicitly designed for pipes — no PTY
dependency needed.

*Reversal:* an interactive-only claude feature with no headless equivalent
becomes a hard requirement → revisit a PTY *adjunct* (never the primary surface).

### D2 — Session model: stateless per-turn `--resume`

A session is `{ UUID, Eidolon identity, working dir, permission mode,
transcript, status }`. Each turn spawns a fresh `claude` process — turn 1 with
`--session-id <uuid>`, later turns with `--resume <uuid>`. The registry is keyed
by UUID; the process is an ephemeral per-turn detail.

*Rationale:* sidesteps the need for a long-lived stdin-writing process,
makes cancellation safe (killing between turns is harmless — state lives in
claude-code's `--resume` store), and reuses the spawn idiom GAMBIT already owns.

*Reversal:* users need true mid-run interrupt / message queueing → swap the
active-turn transport for a long-lived `stream-json` stdin process. The
UUID-keyed registry makes this a non-breaking internal change.

### D3 — Integration: spawn the `claude` CLI directly from Rust

The Rust backend spawns `claude` and parses NDJSON with `serde_json`. No
Node/Python Agent-SDK sidecar.

*Rationale:* there is no Rust Agent SDK; a sidecar means bundling a runtime and
a third process layer. The all-Rust subprocess spine is leaner. Interactive
per-tool permission approval (which the SDK's `canUseTool` would simplify) is
deferred to v0.4.

*Reversal:* interactive per-tool approval becomes mandatory *and* the
`--permission-prompt-tool` MCP route proves too clumsy → reconsider an
SDK sidecar, scoped to the permission callback only.

### D4 — Eidolon mapping: `--append-system-prompt`, never `--bare`

"Launch the ATLAS Eidolon" injects `.eidolons/atlas/agent.md` via
`--append-system-prompt`; `agent.md` front-matter `allowed-tools` maps to
`--allowedTools`. `claude` runs **without** `--bare`.

*Rationale:* `--bare` strips *both* keychain/OAuth auth *and* subagent/skill
discovery. Persona-via-system-prompt is deterministic and does not depend on
non-deterministic subagent delegation. Running without `--bare` keeps
subscription auth and the Eidolons' own skills working. **Adding `--bare` later
would break auth and skills — a tracked do-not.**

*Reversal:* headless `claude` gains a documented, deterministic "run AS
subagent X" flag → revisit targeting the installed `.claude/agents/<name>.md`.

### D5 — UI: dedicated Sessions route, multi-capable backend, single-session UI

A dedicated **Sessions** route. The backend `SessionRegistry` is
multi-session-capable; the v0.3 UI drives one active session. Tabs are deferred
to v0.4. The Roster route is the launch point, reading the *project's* Eidolons.

*Reversal:* concurrent multi-Eidolon workflows become a v0.3-level requirement
→ promote to tabbed multi-session UI (a frontend-only change — the registry
already supports it).

### D6 — Backend shape: a new `session.rs`, a shared `spawn_core`

Session semantics (UUID registry, NDJSON framing, graceful shutdown, a
stdin-capable abstraction) live in a new `session.rs`. Common spawn mechanics
were extracted into a minimal `spawn_core` helper. The five existing one-shot
verbs were **not** retrofitted onto `spawn_core` in v0.3.

*Reversal:* if `spawn_core` turns out to share ≥80 % of mechanics with the
one-shot verbs, unify them and retrofit; if <30 %, let `session.rs` be fully
standalone.

## Consequences

- **R1 — permission aborts.** In headless mode a tool call outside the
  allow-list aborts the run with no waitable prompt. v0.3 mitigates with a
  pre-launch permission-mode choice + an honest UI warning; interactive
  approval (`--permission-prompt-tool` MCP) is a v0.4 follow-up.
- **R3 — cancel is SIGKILL.** Between-turn kills are harmless; mid-turn kill is
  ungraceful — an accepted v0.3 limitation (graceful SIGINT would need `nix`).
- **R6 — dropped `result` event.** A turn finalizes on the `result` event *or*
  clean process exit, whichever is first (`hadResult` records which).
- **R7 — single-vendor.** `stream-json` is a claude-code idiom. Flag
  construction + NDJSON parsing sit behind a `ClaudeCodeAdapter` seam so a
  future `CursorAdapter` is additive.

## Deferred to v0.4+

PTY / interactive TUI · Agent-SDK sidecar · multi-session tabs · interactive
`--permission-prompt-tool` approval · `CursorAdapter` and other host tools ·
`shared_dispatch` semantics · graceful SIGINT cancel · retrofitting the five
one-shot verbs onto `spawn_core`.
