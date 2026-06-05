# Vessel-Tracking-App
Web app still in production.
app is working correctly. Free AIS APIs simply don't have the receiver infrastructure or satellite data to show vessels in low-coverage regions like much of Africa's coastline and open waters.

## Current frontend
The app now uses the Node/Leaflet frontend in `Public/` and is served by `server.js`.
Run `npm start` from the repository root to launch the server. 

## Enrichment (patching coverage gaps)

This server can optionally call one or more external vessel-metadata APIs to "enrich" AIS position messages with extra fields (type, flag, callsign, last port, etc.). This helps patch coverage gaps when the real-time stream lacks metadata.

Configuration:
- `VESSEL_PROVIDERS`: JSON array of provider URLs, e.g. `["https://api.example.com/lookup?mmsi={mmsi}"]`.
- Or use `VESSEL_API_1_URL` and `VESSEL_API_2_URL` as fallbacks.
- Provider URLs should include `{mmsi}` which will be replaced with the vessel MMSI. Include any API key query params in the URL if required.
- `ENRICH_TTL_MS`: how long to cache provider responses per MMSI (default 12h).

Notes:
- The server will try providers in order and stop at the first successful response.
- Provider response formats vary; the server attempts to extract common fields if present.
- You must supply your own API keys for any third-party services you choose.

Example env (in `.env`):

```
VESSEL_PROVIDERS=["https://myfreeapi.example/ship?mmsi={mmsi}&key=YOURKEY","https://another.example/v1/lookup/{mmsi}"]
ENRICH_TTL_MS=43200000
```