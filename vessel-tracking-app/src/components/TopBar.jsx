export default function TopBar({ connected, vesselCount }) {
  return (
    <div className="topbar">
      <h1>🛳 VESSEL TRACKER</h1>

      <div className="status">
        <span className={`dot ${connected ? "live" : ""}`} />
        <span>{connected ? "Live" : "Connecting..."}</span>
      </div>

      <div className="vessel-count">
        Vessels: <strong>{vesselCount}</strong>
      </div>
    </div>
  );
}