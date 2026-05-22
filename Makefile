# Makefile — GAMBIT convenience shortcuts
#
# All targets except `dev` run inside Docker (keeps the macOS host clean).
# `dev` opens the Tauri window on the macOS host directly because stock
# Docker cannot render a Cocoa window — it requires host Rust + Node +
# Tauri CLI installed (one-time setup, see Tauri 2 prerequisites:
# https://v2.tauri.app/start/prerequisites/).

COMPOSE_RUN = docker compose run --rm dev

.PHONY: install lint typecheck test cargo-check ci shell dev

## install — resolve pnpm dependencies inside the container
install:
	$(COMPOSE_RUN) pnpm install

## lint — run Biome check inside the container
lint:
	$(COMPOSE_RUN) pnpm lint

## typecheck — run TypeScript type-check inside the container
typecheck:
	$(COMPOSE_RUN) pnpm type-check

## cargo-check — run cargo check inside the container
cargo-check:
	$(COMPOSE_RUN) cargo check --manifest-path src-tauri/Cargo.toml

## test — run the Vitest unit suite inside the container
test:
	$(COMPOSE_RUN) pnpm test

## ci — full CI parity: install + lint + typecheck + test + cargo-check (sequentially)
ci: install lint typecheck test cargo-check

## shell — drop into a bash shell inside the container
shell:
	$(COMPOSE_RUN) bash

## dev — open the Tauri desktop window on the HOST (macOS GUI, not containerised).
##       Requires host prerequisites: Rust stable, Node 22, pnpm 10.x, Tauri CLI v2.
##       Install prereqs once: https://v2.tauri.app/start/prerequisites/
dev:
	pnpm tauri dev
