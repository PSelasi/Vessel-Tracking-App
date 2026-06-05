import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import TopBar from "./components/TopBar";
import VesselMap from "./components/VesselMap";
import InfoPanel from "./components/InfoPanel";
import "./App.css";

// Dynamically target the backend tunnel URL
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
});

export default function App() {
  const [connected, setConnected]       = useState(false);
  const [vessels, setVessels]           = useState({});       // mmsi → vessel data
  const [selectedMMSI, setSelectedMMSI] = useState(null);
  const vesselCount = Object.keys(vessels).length;

  useEffect(() => {
    socket.on("connect",    () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("vesselUpdate", (v) => {
      if (!v.lat || !v.lng) return;

      setVessels((prev) => ({
        ...prev,
        [v.mmsi]: v,        // add or overwrite — React re-renders only changed markers
      }));
    });

    return () => socket.removeAllListeners();
  }, []);

  const selectedVessel = selectedMMSI ? vessels[selectedMMSI] : null;

  return (
    <div className="app">
      <TopBar connected={connected} vesselCount={vesselCount} />

      <VesselMap
        vessels={vessels}
        selectedMMSI={selectedMMSI}
        onSelectVessel={setSelectedMMSI}
      />

      {selectedVessel && (
        <InfoPanel
          vessel={selectedVessel}
          onClose={() => setSelectedMMSI(null)}
        />
      )}
    </div>
  );
}