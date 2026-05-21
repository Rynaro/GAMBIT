import type { MouseEvent } from "react";
import { Command } from "cmdk";
import { COMMANDS, GROUP_LABELS, resolveCommand } from "@/lib/commands";
import type { CommandGroup, CommandId } from "@/lib/commands";
import type { CommandPaletteState } from "@/lib/useCommandPalette";
import "./CommandPalette.css";

const GROUPS: CommandGroup[] = ["navigate", "actions", "about"];

export function CommandPalette({ open, setOpen }: CommandPaletteState) {
  if (!open) return null;

  function handleSelect(id: string) {
    resolveCommand(id as CommandId);
    setOpen(false);
  }

  function handleBackdropClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) setOpen(false);
  }

  return (
    <div
      className="palette-backdrop"
      role="presentation"
      onClick={handleBackdropClick}
    >
      <Command
        className="palette-sheet"
        role="dialog"
        aria-label="GAMBIT command palette"
        loop
      >
        <div className="palette-input-row">
          <Command.Input
            className="palette-input"
            placeholder="Type a command or search…"
            autoFocus
          />
        </div>

        <Command.List className="palette-list">
          <Command.Empty className="palette-empty">
            No commands found.
          </Command.Empty>

          {GROUPS.map((group) => {
            const items = COMMANDS.filter((c) => c.group === group);
            if (items.length === 0) return null;
            return (
              <Command.Group
                key={group}
                heading={
                  <span className="palette-group-label">
                    {GROUP_LABELS[group]}
                  </span>
                }
              >
                {items.map((cmd) => (
                  <Command.Item
                    key={cmd.id}
                    value={cmd.label}
                    onSelect={() => handleSelect(cmd.id)}
                  >
                    <div className="palette-item">
                      <span className="palette-item-label">{cmd.label}</span>
                      <span className="palette-item-id">{cmd.id}</span>
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            );
          })}
        </Command.List>
      </Command>
    </div>
  );
}
