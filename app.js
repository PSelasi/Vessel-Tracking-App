
    // ── STEP 1: Build the map ─────────────────────────────────────────────────
    const map = L.map("map", {
      center: [20, 0],      // start centered on the world
      zoom: 3,
      zoomControl: true,
    });

    // Base layer — OpenStreetMap (dark-friendly nautical feel)
    const osmLayer = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors",
      }
    );

    // ── STEP 2: Add OpenSeaMap as an overlay ─────────────────────────────────
    // This is the nautical garnish — buoys, depth contours, beacons.
    // It sits ON TOP of the base map as a transparent overlay.
    const openSeaMap = L.tileLayer(
      "https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        opacity: 0.8,
        attribution: "© OpenSeaMap contributors",
      }
    );

    // Stack them: OSM base → OpenSeaMap overlay
    osmLayer.addTo(map);
    openSeaMap.addTo(map);

    // Layer control (top-right toggle)
    L.control.layers(
      { "OpenStreetMap": osmLayer },
      { "OpenSeaMap (nautical)": openSeaMap }
    ).addTo(map);

    // ── STEP 3: Vessel marker setup ───────────────────────────────────────────
    const vessels = {};   // mmsi → { marker, data }
    let vesselCount = 0;

    // Custom ship icon — a small directional arrow
    function getVesselIcon(heading) {
      const angle = (heading && heading !== 511) ? heading : 0;
      return L.divIcon({
        className: "",
        html: `<div style="
          width: 0; height: 0;
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-bottom: 14px solid #3ecf8e;
          transform: rotate(${angle}deg);
          filter: drop-shadow(0 0 3px #3ecf8e88);
        "></div>`,
        iconSize: [10, 14],
        iconAnchor: [5, 7],
      });
    }

    // ── STEP 4: Receive vessel updates from server ────────────────────────────
    const socket = io();

    socket.on("connect", () => {
      document.getElementById("status-dot").classList.add("live");
      document.getElementById("status-text").textContent = "Live";
    });

    socket.on("disconnect", () => {
      document.getElementById("status-dot").classList.remove("live");
      document.getElementById("status-text").textContent = "Disconnected";
    });

    socket.on("vesselUpdate", (v) => {
      if (!v.lat || !v.lng) return;

      if (vessels[v.mmsi]) {
        // Update existing marker
        vessels[v.mmsi].marker
          .setLatLng([v.lat, v.lng])
          .setIcon(getVesselIcon(v.heading));
        vessels[v.mmsi].data = v;
      } else {
        // Create new marker
        const marker = L.marker([v.lat, v.lng], {
          icon: getVesselIcon(v.heading),
          title: v.name,
        }).addTo(map);

        marker.on("click", () => showPanel(v.mmsi));
        vessels[v.mmsi] = { marker, data: v };
        vesselCount++;
        document.getElementById("count").textContent = vesselCount;
      }

      // Refresh panel if this vessel is currently selected
      if (selectedMMSI === v.mmsi) showPanel(v.mmsi);
    });

    // ── STEP 5: Info panel ────────────────────────────────────────────────────
    let selectedMMSI = null;

    function showPanel(mmsi) {
      const v = vessels[mmsi]?.data;
      if (!v) return;
      selectedMMSI = mmsi;

      document.getElementById("panel-name").textContent    = v.name || "Unknown";
      document.getElementById("panel-mmsi").textContent    = v.mmsi;
      document.getElementById("panel-speed").textContent   = v.speed != null ? `${v.speed} kn` : "—";
      document.getElementById("panel-heading").textContent = v.heading && v.heading !== 511 ? `${v.heading}°` : "—";
      document.getElementById("panel-course").textContent  = v.course != null ? `${v.course.toFixed(1)}°` : "—";
      document.getElementById("panel-pos").textContent     = `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}`;
      document.getElementById("panel-time").textContent    = v.timestamp
        ? new Date(v.timestamp).toLocaleTimeString()
        : "—";

      document.getElementById("info-panel").style.display = "block";
    }

    function closePanel() {
      selectedMMSI = null;
      document.getElementById("info-panel").style.display = "none";
    }
  