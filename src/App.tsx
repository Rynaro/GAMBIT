import "./styles/global.css";
import { Sidebar } from "./components/Sidebar";
import { MainPane } from "./components/MainPane";

export function App() {
  return (
    <div className="app-shell">
      <Sidebar />
      <MainPane />
    </div>
  );
}
