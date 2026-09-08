import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import Kiosk from "./pages/Kiosk";
import Queue from "./pages/Queue";
import Camera from "./pages/Camera";
//import Watch from "./pages/Watch";
import AuthGate from "./components/AuthGate";

export default function App() {
  return (
    <BrowserRouter>
      <AuthGate>
        <Routes>
          <Route path="/" element={<Navigate to="/kiosk" replace />} />
          <Route path="/kiosk" element={<Kiosk />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/camera" element={<Camera />} />
          {/* <Route path="/watch" element={<Watch />} /> */}
        </Routes>
      </AuthGate>
    </BrowserRouter>
  );
}
