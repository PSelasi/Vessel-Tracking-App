import { useState, useEffect } from "react";
import { io } from "socket.io-client";
import TopBar from "./components/TopBar";
import VesselMap from "./components/VesselMap";
import InfoPanel from "./components/InfoPanel";
import SearchPanel from "./components/SearchPanel";
import "./App.css";

// Connect to backend server for real-time vessel tracking data
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:3000";
const socket = io(BACKEND_URL, { transports: ["websocket", "polling"] });

export default function App() {
  // Track real-time connection status with backend
  const [connected, setConnected]         = useState(false);
  
  // Store all vessels: key is MMSI (Maritime Mobile Service Identity), value is vessel data
  const [vessels, setVessels]             = useState({});
  
  // Track which vessel is currently selected by user for detail view
  const [selectedMMSI, setSelectedMMSI]   = useState(null);
  
  // Control visibility of search panel for finding vessels
  const [searchOpen, setSearchOpen]       = useState(false);

  // Initialize real-time websocket connection and listen for vessel updates
  useEffect(() => {
    // Update connection status
    socket.on("connect",    () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    
    // Handle incoming vessel position/data updates from backend
    socket.on("vesselUpdate", (v) => {
      if (!v.lat || !v.lng) return; // Ignore vessels without valid coordinates
      setVessels((prev) => ({ ...prev, [v.mmsi]: v })); // Add or update vessel in state
    });
    
    return () => socket.removeAllListeners(); // Cleanup event listeners on unmount
  }, []);

  // Get vessel object for currently selected MMSI (used by InfoPanel)
  const selectedVessel = selectedMMSI ? vessels[selectedMMSI] : null;

  return (
    <div className="app">
      {/* Header bar — shows connection status, vessel count, and search button */}
      <TopBar
        connected={connected}
        vesselCount={Object.keys(vessels).length}
        onSearchOpen={() => setSearchOpen(true)}
      />

      {/* Interactive map showing all vessel markers and selected vessel zoom */}
      <VesselMap
        vessels={vessels}
        selectedMMSI={selectedMMSI}
        onSelectVessel={setSelectedMMSI}
        containerStyle={{ width: "100%", height: "calc(100vh - 72px)" }}
      />

      {/* Side panel with detailed info for selected vessel — only shows when a vessel is selected */}
      {selectedVessel && (
        <InfoPanel
          vessel={selectedVessel}
          onClose={() => setSelectedMMSI(null)}
        />
      )}

      {/* Modal search dialog for finding and selecting vessels — triggered from TopBar */}
      {searchOpen && (
        <SearchPanel
          vessels={vessels}
          onSelectVessel={setSelectedMMSI}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {/* Speed legend — shows vessel color-coding by speed */}
      <div className="legend">
        <div className="legend-title">Speed</div>
        {[
          { color: "#f05050", label: "Anchored (0 kn)" },
          { color: "#f5a623", label: "Slow (< 5 kn)"  },
          { color: "#3ecf8e", label: "Normal (5–14 kn)"},
          { color: "#7eb8f7", label: "Fast (14+ kn)"  },
          { color: "#8a9bb5", label: "Unknown"         },
        ].map(({ color, label }) => (
          <div className="legend-row" key={label}>
            <span className="legend-dot" style={{ background: color }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}