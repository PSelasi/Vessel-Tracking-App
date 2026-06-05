// ── STEP 1: Build the map ─────────────────────────────────────────────────
const map = L.map("map", {
  center: [20, 0],
  zoom: 3,
  zoomControl: true,
  preferCanvas: true,
  renderer: L.canvas({ padding: 0.5 }),  // optimize canvas rendering
  maxBounds: [[-85.051129, -180], [85.051129, 180]],  // restrict panning
  maxBoundsViscosity: 1.0,
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
    opacity: 0.4,  // reduced opacity for faster rendering
    attribution: "© OpenSeaMap contributors",
  }
);

// Stack them: OSM base → OpenSeaMap overlay (off by default to improve performance)
osmLayer.addTo(map);
// openSeaMap.addTo(map);  // commented out for better performance; users can toggle it on

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

function getVesselState(speed) {
  const parsed = Number(speed);
  if (Number.isNaN(parsed)) {
    return { label: "Unknown", color: "#8a9bb5" };
  }

  if (parsed <= 0.3) {
    return { label: "Anchored / moored", color: "#f05050" };
  }

  if (parsed < 5) {
    return { label: "Slow / manoeuvring", color: "#f5a623" };
  }

  if (parsed < 14) {
    return { label: "En route", color: "#3ecf8e" };
  }

  return { label: "Fast / underway", color: "#7eb8f7" };
}

function getVesselIcon(heading, speed) {
  const angle = (heading && heading !== 511) ? heading : 0;
  const { color } = getVesselState(speed);
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 0; height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-bottom: 14px solid ${color};
      transform: rotate(${angle}deg);
      filter: drop-shadow(0 0 3px ${color}88);
    "></div>`,
    iconSize: [10, 14],
    iconAnchor: [5, 7],
  });
}

function getVesselIconHighlighted(heading, speed) {
  const angle = (heading && heading !== 511) ? heading : 0;
  const { color } = getVesselState(speed);
  const glowColor = color + "66";
  return L.divIcon({
    className: "",
    html: `<div style="
      width: 0; height: 0;
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-bottom: 22px solid ${color};
      transform: rotate(${angle}deg);
      filter: drop-shadow(0 0 0 3px ${glowColor}) drop-shadow(0 0 6px ${color}cc);
    "></div>`,
    iconSize: [16, 22],
    iconAnchor: [8, 11],
  });
}

if (searchInput) {
  let searchDebounceTimer = null;
  
  searchInput.addEventListener("input", (event) => {
    clearTimeout(searchDebounceTimer);
    // Longer debounce (500ms) to prevent search from blocking keyboard input (INP fix)
    searchDebounceTimer = setTimeout(() => {
      updateSearchResults(event.target.value);
    }, 500);
  });

  window.addEventListener("click", (event) => {
    if (searchContainer && !searchContainer.contains(event.target)) {
      clearSearchResults();
    }
  });
}

// ── STEP 4: Receive vessel updates from server ────────────────────────────
// Throttle updates to prevent overwhelming re-renders
let lastUpdateTime = 0;
const UPDATE_THROTTLE_MS = 500;  // max 2 updates/sec — much less main-thread blocking for INP
let throttledUpdates = [];

// Viewport filtering: only render markers visible on screen
function isMarkerInViewport(lat, lng) {
  const bounds = map.getBounds();
  return bounds.contains([lat, lng]);
}

function updateMarkerVisibility() {
  // Defer to idle time to avoid blocking user interactions
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(() => {
      Object.entries(vessels).forEach(([mmsi, entry]) => {
        const data = entry.data;
        const shouldShow = isMarkerInViewport(data.lat, data.lng);
        const isShown = map.hasLayer(entry.marker);
        
        if (shouldShow && !isShown) {
          map.addLayer(entry.marker);
        } else if (!shouldShow && isShown && selectedMMSI !== mmsi) {
          map.removeLayer(entry.marker);
        }
      });
    });
  } else {
    Object.entries(vessels).forEach(([mmsi, entry]) => {
      const data = entry.data;
      const shouldShow = isMarkerInViewport(data.lat, data.lng);
      const isShown = map.hasLayer(entry.marker);
      
      if (shouldShow && !isShown) {
        map.addLayer(entry.marker);
      } else if (!shouldShow && isShown && selectedMMSI !== mmsi) {
        map.removeLayer(entry.marker);
      }
    });
  }
}

map.on('moveend', updateMarkerVisibility);
setInterval(() => {
  // Only check visibility every 2s to avoid blocking interactions
  updateMarkerVisibility();
}, 2000);

function flushThrottledUpdates() {
  // Defer to idle callback to avoid blocking main thread during user interactions
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(() => {
      throttledUpdates.forEach((v) => processVesselUpdate(v));
      throttledUpdates = [];
    });
  } else {
    throttledUpdates.forEach((v) => processVesselUpdate(v));
    throttledUpdates = [];
  }
}

function processVesselUpdate(v) {
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
      const isSelected = selectedMMSI === v.mmsi;
      const icon = isSelected
        ? getVesselIconHighlighted(v.heading, v.speed)
        : getVesselIcon(v.heading, v.speed);
      existing.marker.setLatLng([v.lat, v.lng]).setIcon(icon);
      
      // Update popup position if visible (deferred to avoid blocking)
      if (isSelected && existing.popup) {
        requestAnimationFrame(() => {
          if (existing.popup) {
            existing.popup.setLatLng([v.lat, v.lng]);
          }
        });
      }
    }
  } else {
    const marker = L.marker([v.lat, v.lng], {
      icon: getVesselIcon(v.heading, v.speed),
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
}

setInterval(flushThrottledUpdates, UPDATE_THROTTLE_MS);

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
  throttledUpdates.push(v);
  const now = Date.now();
  if (now - lastUpdateTime >= UPDATE_THROTTLE_MS) {
    flushThrottledUpdates();
    lastUpdateTime = now;
  }
});

// ── STEP 5: Info panel ───────────────────────────────────────────────────
let previouslySelectedMMSI = null;

function showPanel(mmsi, center = true) {
  const v = vessels[mmsi]?.data;
  if (!v) return;

  // IMMEDIATE: Set selected and show panel (fast, no blocking)
  selectedMMSI = mmsi;
  document.getElementById("info-panel").style.display = "block";

  // NEXT FRAME: Update visuals (icon, popup) via requestAnimationFrame
  requestAnimationFrame(() => {
    // Clear previous selection's icon and popup
    if (previouslySelectedMMSI && previouslySelectedMMSI !== mmsi && vessels[previouslySelectedMMSI]) {
      const prev = vessels[previouslySelectedMMSI];
      prev.marker.setIcon(getVesselIcon(prev.data.heading, prev.data.speed));
      if (prev.popup) {
        try { map.removeLayer(prev.popup); } catch (e) {}
        prev.popup = null;
      }
    }

    // Highlight current vessel
    const state = getVesselState(v.speed);
    vessels[mmsi].marker.setIcon(getVesselIconHighlighted(v.heading, v.speed));
    
    // Create popup
    if (vessels[mmsi].popup) {
      try { map.removeLayer(vessels[mmsi].popup); } catch (e) {}
    }
    const popupContent = `<div style="text-align: center; font-weight: bold; font-size: 12px; color: ${state.color};">${state.label}</div>`;
    const popup = L.popup({ closeButton: false, offset: L.point(0, -25) })
      .setLatLng([v.lat, v.lng])
      .setContent(popupContent)
      .openOn(map);
    vessels[mmsi].popup = popup;
    
    previouslySelectedMMSI = mmsi;
  });

  // IDLE: Populate details asynchronously (doesn't block interactions)
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(() => populatePanelDetails(v, center), { timeout: 1000 });
  } else {
    setTimeout(() => populatePanelDetails(v, center), 50);
  }
}

function populatePanelDetails(v, center) {
  const state = getVesselState(v.speed);
  
  document.getElementById("panel-name").textContent    = v.name || "Unknown";
  document.getElementById("panel-mmsi").textContent    = v.mmsi;
  document.getElementById("panel-status").textContent  = state.label;
  document.getElementById("panel-type").textContent    = v.type || "—";
  document.getElementById("panel-flag").textContent    = v.flag || "—";
  document.getElementById("panel-callsign").textContent = v.callsign || "—";
  document.getElementById("panel-lastport").textContent = v.lastPort || "—";
  document.getElementById("panel-destination").textContent = v.destination || "—";
  document.getElementById("panel-speed").textContent   = v.speed != null ? `${v.speed} kn` : "—";
  document.getElementById("panel-heading").textContent = v.heading && v.heading !== 511 ? `${v.heading}°` : "—";
  document.getElementById("panel-course").textContent  = v.course != null ? `${v.course.toFixed(1)}°` : "—";
  document.getElementById("panel-pos").textContent     = `${v.lat.toFixed(4)}, ${v.lng.toFixed(4)}`;
  document.getElementById("panel-time").textContent    = v.timestamp
    ? new Date(v.timestamp).toLocaleTimeString()
    : "—";

  // Deferred map animation only if center=true
  if (center && v.lat && v.lng) {
    requestAnimationFrame(() => {
      map.flyTo([v.lat, v.lng], 7, { duration: 1.2 });
    });
  }
}

function closePanel() {
  if (selectedMMSI && vessels[selectedMMSI]) {
    const v = vessels[selectedMMSI];
    requestAnimationFrame(() => {
      v.marker.setIcon(getVesselIcon(v.data.heading, v.data.speed));
      if (v.popup) {
        try {
          map.removeLayer(v.popup);
        } catch (e) {
          // popup already removed
        }
        v.popup = null;
      }
    });
  }
  selectedMMSI = null;
  previouslySelectedMMSI = null;
  document.getElementById("info-panel").style.display = "none";
}
