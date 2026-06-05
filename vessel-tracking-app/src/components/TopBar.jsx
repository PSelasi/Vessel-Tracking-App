export default function TopBar({ connected, vesselCount, onSearchOpen }) {
  return (
    <div className="topbar">
      <h1>🛳 VESSEL TRACKER</h1>

      <div className="search-trigger" onClick={onSearchOpen}>
        <span className="search-icon">🔍</span>
        <span>Search vessels...</span>
      </div>

      <div className="topbar-right">
        <div className="status">
          <span className={`dot ${connected ? "live" : ""}`} />
          <span>{connected ? "Live" : "Connecting..."}</span>
        </div>
        <div className="vessel-count">
          Vessels: <strong>{vesselCount}</strong>
        </div>
      </div>
    </div>
  );
}