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

  aisWs.on("message", (rawData) => {
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
      };

     // Skip if position is invalid (0,0 is a common bad-data artifact)
    if (vessel.lat === 0 && vessel.lng === 0) return;

//STEP 4: Broadcast to all connected browser clients 
// Socket.io pushes this to every open map tab instantly.
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