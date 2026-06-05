import { useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  LayersControl,
  ZoomControl,
  ScaleControl,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const { BaseLayer, Overlay } = LayersControl;

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

// Build a directional triangle icon per vessel heading + speed-based coloring
function vesselIcon(heading, speed) {
  const angle = heading && heading !== 511 ? heading : 0;

  // Color by speed — Carto-inspired palette
  const color =
    speed == null   ? "#8a9bb5" :   // unknown — gray
    speed === 0     ? "#f05050" :   // anchored — red
    speed < 5       ? "#f5a623" :   // slow — amber
    speed < 14      ? "#3ecf8e" :   // normal — green
                      "#7eb8f7";    // fast — blue

  return L.divIcon({
    className: "",
    html: `<div style="
      width:0; height:0;
      border-left:5px solid transparent;
      border-right:5px solid transparent;
      border-bottom:14px solid ${color};
      transform:rotate(${angle}deg);
      filter:drop-shadow(0 0 4px ${color}88);
    "></div>`,
    iconSize:   [10, 14],
    iconAnchor: [5, 7],
  });
}

// Inner component — manages markers imperatively via Leaflet API
// react-leaflet re-renders are too slow for hundreds of moving markers
function VesselLayer({ vessels, selectedMMSI, onSelectVessel }) {
  const map            = useMap();
  const markersRef     = useRef({});  // mmsi → L.marker (lives outside React render)
  const prevVesselsRef = useRef({});

  // Fly to vessel when selected via search
  useEffect(() => {
    if (!selectedMMSI) return;
    const v = vessels[selectedMMSI];
    if (v?.lat && v?.lng) {
      map.flyTo([v.lat, v.lng], 8, { duration: 1.5 });
    }
  }, [selectedMMSI, vessels, map]);

  useEffect(() => {
    const prevVessels = prevVesselsRef.current;

    Object.values(vessels).forEach((v) => {
      const previous = prevVessels[v.mmsi];
      const marker   = markersRef.current[v.mmsi];
      const hasChanged =
        !previous ||
        previous.lat !== v.lat ||
        previous.lng !== v.lng ||
        previous.heading !== v.heading ||
        previous.speed !== v.speed ||
        previous.name !== v.name;

      if (marker) {
        if (!hasChanged) return;
        marker.setLatLng([v.lat, v.lng]).setIcon(vesselIcon(v.heading, v.speed));
      } else {
        const marker = L.marker([v.lat, v.lng], {
          icon:  vesselIcon(v.heading, v.speed),
          title: v.name,
        }).addTo(map);

        marker.on("click", () => onSelectVessel(v.mmsi));
        markersRef.current[v.mmsi] = marker;
      }
    });

    prevVesselsRef.current = vessels;
  }, [vessels, map, onSelectVessel]);

  return null;     // this component renders nothing — Leaflet owns the DOM
}

// Wrapper to use VesselLayer as a LayersControl overlay
function VesselLayerWrapper({ vessels, selectedMMSI, onSelectVessel }) {
  return (
    <VesselLayer
      vessels={vessels}
      selectedMMSI={selectedMMSI}
      onSelectVessel={onSelectVessel}
    />
  );
}

export default function VesselMap({ vessels, selectedMMSI, onSelectVessel, containerStyle }) {
  return (
    <MapContainer
      center={[20, 0]}
      zoom={3}
      style={containerStyle ?? { flex: 1, width: "100%" }}
      zoomControl={false}
    >
      <LayersControl position="topright">

        {/* ── Carto base layers ───────────────────────────── */}
        <BaseLayer checked name="Dark Matter (default)">
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            maxZoom={19}
          />
        </BaseLayer>

        <BaseLayer name="Dark Matter (no labels)">
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            maxZoom={19}
          />
        </BaseLayer>

        <BaseLayer name="Voyager (light nautical)">
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            maxZoom={19}
          />
        </BaseLayer>

        <BaseLayer name="Positron (minimal light)">
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            maxZoom={19}
          />
        </BaseLayer>

        <BaseLayer name="Positron (no labels)">
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            maxZoom={19}
          />
        </BaseLayer>

        {/* ── Overlays ─────────────────────────────────────── */}
        <Overlay checked name="OpenSeaMap (nautical)">
          <TileLayer
            url="https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"
            attribution="© OpenSeaMap contributors"
            opacity={0.8}
            maxZoom={19}
          />
        </Overlay>

        <Overlay checked name="Vessel markers">
          <VesselLayerWrapper
            vessels={vessels}
            selectedMMSI={selectedMMSI}
            onSelectVessel={onSelectVessel}
          />
        </Overlay>

      </LayersControl>

      <ZoomControl position="bottomright" />
      <ScaleControl position="bottomleft" imperial={false} />
    </MapContainer>
  );
}