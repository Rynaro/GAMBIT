import { useEffect } from "react";
import "./styles/global.css";
import { Sidebar } from "./components/Sidebar";
import { MainPane } from "./components/MainPane";
import { CommandPalette } from "./components/CommandPalette";
import { useCommandPalette } from "./lib/useCommandPalette";
import { setupPlatform } from "./lib/platform";

export function App() {
  useEffect(() => {
    setupPlatform();
  }, []);

  const palette = useCommandPalette();

  return (
    <div className="app-shell">
      <Sidebar palette={palette} />
      <MainPane />
      <CommandPalette open={palette.open} setOpen={palette.setOpen} />
    </div>
  );
}
