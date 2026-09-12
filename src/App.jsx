import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import Kiosk from "./pages/Kiosk";
import Queue from "./pages/Queue";
import Camera from "./pages/Camera";

import AuthGate from "./components/AuthGate";

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <Routes>
          <Route path="/" element={<Navigate to="/kiosk" replace />} />
          <Route path="/kiosk" element={<Kiosk />} />
          <Route
            path="/queue"
            element={<Navigate to="/queue/left" replace />}
          />
          <Route path="/queue/left" element={<Queue side="left" />} />
          <Route path="/queue/right" element={<Queue side="right" />} />
          <Route path="/camera" element={<Camera />} />
        </Routes>
      </AuthGate>
    </BrowserRouter>
  );
}
