
    // ── STEP 1: Build the map ─────────────────────────────────────────────────
    const map = L.map("map", {
      center: [20, 0],      // start centered on the world
      zoom: 3,
      zoomControl: true,
      preferCanvas: true,
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
    let selectedMMSI = null;

    const searchInput = document.getElementById("search-input");
    const searchResults = document.getElementById("search-results");
    const searchContainer = document.getElementById("search-container");

    function normalizeSearchText(value) {
      return (value || "").toString().trim().toLowerCase();
    }

    function clearSearchResults() {
      if (!searchResults) return;
      searchResults.innerHTML = "";
      searchResults.style.display = "none";
    }

    function updateSearchResults(query) {
      if (!searchResults) return;
      const q = normalizeSearchText(query);
      if (!q) {
        clearSearchResults();
        return;
      }

      const results = Object.values(vessels)
        .map((entry) => entry.data)
        .filter((v) => {
          const name = normalizeSearchText(v.name);
          return name.includes(q) || String(v.mmsi).includes(q);
        })
        .sort((a, b) => {
          const nameA = normalizeSearchText(a.name);
          const nameB = normalizeSearchText(b.name);
          if (nameA !== nameB) return nameA.localeCompare(nameB);
          return a.mmsi - b.mmsi;
        })
        .slice(0, 20);

      searchResults.innerHTML = results.length
        ? results.map((v) => `
            <button class="search-item" type="button" data-mmsi="${v.mmsi}">
              <strong>${v.name || "Unknown Vessel"}</strong>
              <div class="item-meta">
                <span>MMSI: ${v.mmsi}</span>
                <span>${v.lat.toFixed(2)}, ${v.lng.toFixed(2)}</span>
              </div>
            </button>
          `).join("")
        : `<div class="search-empty">No vessels found for “${query}”.</div>`;

      searchResults.style.display = "block";
      searchResults.querySelectorAll(".search-item").forEach((button) => {
        button.addEventListener("click", () => {
          const mmsi = button.dataset.mmsi;
          if (!mmsi) return;
          searchInput.value = "";
          clearSearchResults();
          showPanel(mmsi);
        });
      });
    }

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

    if (searchInput) {
      searchInput.addEventListener("input", (event) => {
        updateSearchResults(event.target.value);
      });

      window.addEventListener("click", (event) => {
        if (searchContainer && !searchContainer.contains(event.target)) {
          clearSearchResults();
        }
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
        const existing = vessels[v.mmsi];
        const previous = existing.data;
        const shouldUpdateMarker =
          previous.lat !== v.lat ||
          previous.lng !== v.lng ||
          previous.heading !== v.heading ||
          previous.speed !== v.speed ||
          previous.name !== v.name;

        existing.data = v;

        if (shouldUpdateMarker) {
          existing.marker
            .setLatLng([v.lat, v.lng])
            .setIcon(getVesselIcon(v.heading));
        }
      } else {
        const marker = L.marker([v.lat, v.lng], {
          icon: getVesselIcon(v.heading),
          title: v.name,
        }).addTo(map);

        marker.on("click", () => showPanel(v.mmsi));
        vessels[v.mmsi] = { marker, data: v };
        vesselCount++;
        document.getElementById("count").textContent = vesselCount;
      }

      if (searchInput?.value.trim()) {
        updateSearchResults(searchInput.value);
      }

      if (selectedMMSI === v.mmsi) showPanel(v.mmsi, false);
    });

    // ── STEP 5: Info panel ───────────────────────────────────────────────────
    function showPanel(mmsi, center = true) {
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

      if (center && v.lat && v.lng) {
        map.flyTo([v.lat, v.lng], 7, { duration: 1.2 });
      }

      document.getElementById("info-panel").style.display = "block";
    }

    function closePanel() {
      selectedMMSI = null;
      document.getElementById("info-panel").style.display = "none";
    }
  