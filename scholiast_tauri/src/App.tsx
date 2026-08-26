import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import BottomTabs from "./components/BottomTabs";
import OfflineBanner from "./components/OfflineBanner";
import { ToastHost } from "./components/Toast";
import FrameDraw from "./frame/FrameDraw";
import Home from "./routes/Home";
import Player from "./routes/Player";
import Reader from "./routes/Reader";
import Settings from "./routes/Settings";
import useIsNarrow from "./hooks/useIsNarrow";

function Shell() {
  const isNarrow = useIsNarrow();
  const location = useLocation();
  const isStudySession = location.pathname === "/player" || location.pathname === "/reader";

  return (
    <div className="flex h-screen overflow-hidden bg-base text-text">
      {!isNarrow && !isStudySession && <Sidebar />}
      <main
        className={`min-w-0 flex-1 overflow-y-auto ${
          isNarrow && !isStudySession ? "pb-[calc(4rem+var(--sc-safe-bottom))]" : ""
        }`}
      >
        <OfflineBanner />
        <Outlet />
      </main>
      {isNarrow && !isStudySession && <BottomTabs />}
      <ToastHost />
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
