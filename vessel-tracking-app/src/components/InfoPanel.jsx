export default function InfoPanel({ vessel: v, onClose }) {
  const rows = [
    ["MMSI",     v.mmsi],
    ["Speed",    v.speed != null ? `${v.speed} kn` : "—"],
    ["Heading",  v.heading && v.heading !== 511 ? `${v.heading}°` : "—"],
    ["Course",   v.course != null ? `${parseFloat(v.course).toFixed(1)}°` : "—"],
    ["Position", `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}`],
    ["Last seen",v.timestamp ? new Date(v.timestamp).toLocaleTimeString() : "—"],
  ];

  return (
    <div className="info-panel">
      <button className="close-btn" onClick={onClose}>✕</button>
      <h2>{v.name || "Unknown Vessel"}</h2>
      {rows.map(([label, value]) => (
        <div className="info-row" key={label}>
          <span className="label">{label}</span>
          <span className="value">{value}</span>
        </div>
      ))}
    </div>
  );
}