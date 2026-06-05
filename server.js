require("dotenv").config();
console.log("API Key loaded:", process.env.AISSTREAM_API_KEY ? "found" : "undefined");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const WebSocket = require("ws");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors({ origin: "*" }));
const server = http.createServer(app);           // HTTP server (the platter)
const io = new Server(server, {
  cors: {
    origin: "*",                    // allow all GitHub Codespaces origins
    methods: ["GET", "POST"],
  }
});

// --- Enrichment cache and helper ----------------------------------------
const enrichmentCache = new Map(); // mmsi -> { data, ts }
const ENRICH_TTL = Number(process.env.ENRICH_TTL_MS) || 12 * 60 * 60 * 1000; // 12h default

function getProviderList() {
  // Primary: provide a JSON array via VESSEL_PROVIDERS env var
  if (process.env.VESSEL_PROVIDERS) {
    try {
      const list = JSON.parse(process.env.VESSEL_PROVIDERS);
      if (Array.isArray(list)) return list;
    } catch (e) {
      console.warn("Invalid VESSEL_PROVIDERS JSON, falling back to individual vars");
    }
  }

  const list = [];
  if (process.env.VESSEL_API_1_URL) list.push(process.env.VESSEL_API_1_URL);
  if (process.env.VESSEL_API_2_URL) list.push(process.env.VESSEL_API_2_URL);
  return list;
}

async function fetchWithTimeout(url, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function enrichVessel(vessel) {
  if (!vessel || !vessel.mmsi) return vessel;

  const cached = enrichmentCache.get(vessel.mmsi);
  if (cached && (Date.now() - cached.ts) < ENRICH_TTL) {
    Object.assign(vessel, cached.data);
    return vessel;
  }

  const providers = getProviderList();
  if (!providers.length) return vessel; // nothing configured

  for (const rawUrl of providers) {
    try {
      const url = rawUrl.replace('{mmsi}', encodeURIComponent(vessel.mmsi));
      const res = await fetchWithTimeout(url, 5000);
      if (!res.ok) continue;
      const json = await res.json();

      // Provider responses vary widely. Try to pull common fields if present.
      const meta = {};
      if (json.type) meta.type = json.type;
      if (json.shipType) meta.type = meta.type || json.shipType;
      if (json.flag) meta.flag = json.flag;
      if (json.country) meta.flag = meta.flag || json.country;
      if (json.callsign) meta.callsign = json.callsign;
      if (json.destination) meta.destination = json.destination;
      if (json.lastPort) meta.lastPort = json.lastPort;
      if (json.prevPort) meta.lastPort = meta.lastPort || json.prevPort;
      if (json.imo) meta.imo = json.imo;
      if (json.name) meta.name = vessel.name === 'Unknown' ? json.name : vessel.name;

      // merge into vessel and cache
      Object.assign(vessel, meta);
      enrichmentCache.set(vessel.mmsi, { data: meta, ts: Date.now() });
      console.log(`Enriched MMSI ${vessel.mmsi} from provider ${rawUrl}`);
      break; // stop after first successful enrichment
    } catch (err) {
      console.debug(`Provider ${rawUrl} failed: ${err.message}`);
      continue;
    }
  }

  return vessel;
}

app.use(express.static("Public"));

// Serve the static node frontend for all other routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "Public/index.html"));
});

const PORT = process.env.PORT || 3000;

//Connect to the AISstream WebSocket
function connectToAISStream() {
  const aisWs = new WebSocket("wss://stream.aisstream.io/v0/stream");

  aisWs.on("open", () => {
    console.log("Connected to aisstream.io");
    // Send a subscription message
    // BoundingBoxes defines the geographic region you want.
    // [] means global. Narrow it to reduce data volume, e.g. Gulf of Guinea.
    const subscriptionMessage = {
      APIKey: process.env.AISSTREAM_API_KEY,
      BoundingBoxes: [
        [[-90, -180], [90, 180]]   // [SW corner, NE corner] — whole world
        // For West Africa only, try: [[0, -20], [15, 5]]
      ],
      FilterMessageTypes: ["PositionReport"]  // Only grab ship positions
    };

    aisWs.send(JSON.stringify(subscriptionMessage));
  });

    // ── STEP 3: Parse every incoming AIS message ─────────────────────────────
  // Raw AIS data comes in as JSON. We extract just what the map needs.

  aisWs.on("message", async (rawData) => {
    try {
      const data = JSON.parse(rawData);

      // aisstream wraps data in a "Message" key
      const posReport = data?.Message?.PositionReport;
      const metaData  = data?.MetaData;
            if (!posReport || !metaData) return; // skip non-position messages

      // The distilled vessel object — only what Leaflet needs
      const vessel = {
        mmsi:      metaData.MMSI,              // unique ship ID
        name:      metaData.ShipName?.trim() || "Unknown",
        lat:       posReport.Latitude,
        lng:       posReport.Longitude,
        speed:     posReport.Sog,              // Speed Over Ground (knots)
        heading:   posReport.TrueHeading,
        course:    posReport.Cog,              // Course Over Ground
        timestamp: metaData.time_utc,
         navStatus: posReport.NavigationStatus || posReport.NavStatus || metaData.NavigationStatus,
         type: metaData.ShipType || metaData.ShipTypeName || metaData.ShipTypeCode || metaData.ShipTypeDescription,
         flag: metaData.Flag || metaData.Country || metaData.CountryOfRegistry,
         callsign: metaData.Callsign || metaData.CallSign,
         destination: metaData.Destination,
         lastPort: metaData.LastPort || metaData.LastPortName || metaData.PrevPort,
         imo: metaData.IMO || metaData.IMONumber,
      };

     // Skip if position is invalid (0,0 is a common bad-data artifact)
    if (vessel.lat === 0 && vessel.lng === 0) return;

  //STEP 4: Enrich (if configured) then broadcast to browser clients
  await enrichVessel(vessel).catch((e) => console.debug('Enrich failed', e.message));
  io.emit("vesselUpdate", vessel);

    } catch (err) {
      console.error("Parse error:", err.message);
    }
  });
  //auto-reconnect if the stream drops 
  // A good chef never lets the pot go cold.

  aisWs.on("close", (code, reason) => {
    console.warn(` AIS stream closed (${code}). Reconnecting in 5s...`);
    setTimeout(connectToAISStream, 5000);
  });

  aisWs.on("error", (err) => {
    console.error("AIS WebSocket error:", err.message);
    aisWs.terminate();
  });
}
// Handle browser clients connecting 
// Log when a browser tab tunes in or drops off.

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});
// Start the server and connect to the AIS stream
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  connectToAISStream();
});