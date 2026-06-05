import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix Leaflet's default icon paths for Vite
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

// Build a directional triangle icon per vessel heading
function vesselIcon(heading) {
  const angle = heading && heading !== 511 ? heading : 0;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:0; height:0;
      border-left:5px solid transparent;
      border-right:5px solid transparent;
      border-bottom:14px solid #3ecf8e;
      transform:rotate(${angle}deg);
      filter:drop-shadow(0 0 3px #3ecf8e88);
    "></div>`,
    iconSize:   [10, 14],
    iconAnchor: [5, 7],
  });
}

// Inner component — manages markers imperatively via Leaflet API
// react-leaflet re-renders are too slow for hundreds of moving markers
function VesselLayer({ vessels, selectedMMSI, onSelectVessel }) {
  const map        = useMap();
  const markersRef = useRef({});  // mmsi → L.marker (lives outside React render)

  useEffect(() => {
    Object.values(vessels).forEach((v) => {
      if (markersRef.current[v.mmsi]) {
        // Update existing marker position + icon
        markersRef.current[v.mmsi]
          .setLatLng([v.lat, v.lng])
          .setIcon(vesselIcon(v.heading));
      } else {
        // Create new marker
        const marker = L.marker([v.lat, v.lng], {
          icon:  vesselIcon(v.heading),
          title: v.name,
        }).addTo(map);

        marker.on("click", () => onSelectVessel(v.mmsi));
        markersRef.current[v.mmsi] = marker;
      }
    });
  }, [vessels]);   // runs every time vessels state updates

  return null;     // this component renders nothing — Leaflet owns the DOM
}

export default function VesselMap({ vessels, selectedMMSI, onSelectVessel }) {
  return (
    <MapContainer
      center={[20, 0]}
      zoom={3}
      style={{ flex: 1, width: "100%" }}
    >
      {/* Base layer */}
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap contributors"
        maxZoom={19}
      />

      {/* OpenSeaMap nautical overlay */}
      <TileLayer
        url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
        attribution="© OpenSeaMap contributors"
        opacity={0.8}
        maxZoom={19}
      />

      <VesselLayer
        vessels={vessels}
        selectedMMSI={selectedMMSI}
        onSelectVessel={onSelectVessel}
      />
    </MapContainer>
  );
}