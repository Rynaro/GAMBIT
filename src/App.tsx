import { useEffect } from "react";
import "./styles/global.css";
import { Sidebar } from "./components/Sidebar";
import { MainPane } from "./components/MainPane";
import { detectAndStampPlatform } from "./lib/platform";

export function App() {
  // Detect OS and write data-platform to <html> before first meaningful paint.
  // CSS uses :root[data-platform="..."] to toggle sidebar vibrancy vs solid fill.
  useEffect(() => {
    detectAndStampPlatform();
  }, []);

  return (
    <div className="app-shell">
      <Sidebar />
      <MainPane />
    </div>
  );
}
