import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import FrameDraw from "./frame/FrameDraw";
import Home from "./routes/Home";
import Player from "./routes/Player";
import Reader from "./routes/Reader";
import Settings from "./routes/Settings";

function Shell() {
  return (
    <div className="flex h-screen overflow-hidden bg-base text-text">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route path="/home" element={<Home />} />
        <Route path="/player" element={<Player />} />
        <Route path="/reader" element={<Reader />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Route>
      <Route path="/frame" element={<FrameDraw />} />
    </Routes>
  );
}
