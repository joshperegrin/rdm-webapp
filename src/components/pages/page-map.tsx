import { useEffect, useRef } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAtom } from "jotai";

import {
  recentSessionsAtom,
  selectedSessionID,
  selectedSession,
  selectedSession_RD_loadable,
  Session,
} from "@/state";

const FALLBACK_LOCATION = {
  lat: 14.444134,
  lng: 120.953242,
  accuracy: 20,
};

function MapPage() {
  /* Jotai from State */
  const [sessions] = useAtom(recentSessionsAtom);
  const [, setSelectedSessionID] = useAtom(selectedSessionID);
  const [session] = useAtom(selectedSession);
  const [rdLoadable] = useAtom(selectedSession_RD_loadable);

  /* Leaflet */
  const mapRef = useRef<L.Map | null>(null);
  const currentMarkerRef = useRef<L.Marker | null>(null);
  const currentCircleRef = useRef<L.Circle | null>(null);
  const rdLayerRef = useRef<L.LayerGroup | null>(null);
    const rdMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const usingFallbackRef = useRef(true);

  /* Map */
  useEffect(() => {
    if (mapRef.current) return;

    mapRef.current = L.map("map").setView(
      [FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lng],
      15
    );

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(mapRef.current);

    // Current location marker (blue)
    currentMarkerRef.current = L.marker([FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lng], {
      icon: L.icon({
        iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png",
        shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41],
      }),
    }).addTo(mapRef.current);

    currentCircleRef.current = L.circle([FALLBACK_LOCATION.lat, FALLBACK_LOCATION.lng], {
      radius: FALLBACK_LOCATION.accuracy,
      color: "blue",
      fillOpacity: 0.1,
    }).addTo(mapRef.current);

    // Layer group for RD markers
    rdLayerRef.current = L.layerGroup().addTo(mapRef.current);

    /* ---------- GPS POLLING (ELECTRON) ---------- */
    const interval = setInterval(async () => {
      try {
        const location = await window.electronAPI.getLocation();
        const isValidGPS =
          location &&
          location.lat !== 0 &&
          location.lng !== 0 &&
          !Number.isNaN(location.lat) &&
          !Number.isNaN(location.lng);

        const lat = isValidGPS ? location.lat : FALLBACK_LOCATION.lat;
        const lng = isValidGPS ? location.lng : FALLBACK_LOCATION.lng;
        const accuracy = isValidGPS ? location.accuracy ?? 10 : FALLBACK_LOCATION.accuracy;

        currentMarkerRef.current?.setLatLng([lat, lng]);
        currentCircleRef.current?.setLatLng([lat, lng]).setRadius(accuracy);

        if (isValidGPS && usingFallbackRef.current) {
          usingFallbackRef.current = false;
          mapRef.current?.setView([lat, lng], 18);
        }
      } catch {
        // silent fallback
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      mapRef.current?.remove();
      mapRef.current = null;
      currentMarkerRef.current = null;
      currentCircleRef.current = null;
      rdLayerRef.current = null;
      rdMarkersRef.current.clear();
    };
  }, []);

  /* ---------- UPDATE RD MARKERS ---------- */
  useEffect(() => {
    if (!mapRef.current || !rdLayerRef.current) return;

    rdLayerRef.current.clearLayers();
    rdMarkersRef.current.clear();

    if (rdLoadable.state !== "hasData") return;

    const rdList = rdLoadable.data;

    rdList.forEach((rd) => {
      const [lat, lng] = rd.location;

      if (lat === 0 || lng === 0 || Number.isNaN(lat) || Number.isNaN(lng)) return;

      const marker = L.marker([lat, lng], {
        icon: L.icon({
          iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
          shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41],
        }),
      }).bindPopup(`
        <b>Classification:</b> ${rd.classification || "Unknown"}<br/>
        <b>Timestamp:</b> ${rd.timestamp || "N/A"}<br/>
        <b>Status:</b> ${rd.fixed ? "Fixed" : "Unfixed"}
      `);

      rdLayerRef.current?.addLayer(marker);
      rdMarkersRef.current.set(rd.id, marker);
    });
  }, [rdLoadable]);

  return (
    <div className="flex h-full w-full">

      {/* Select Sessison */}
      <div className="hidden md:flex md:w-1/4 lg:w-80 flex-col bg-slate-800 p-4 text-white">
        <h2 className="font-semibold mb-4">Sessions</h2>

        <div className="flex flex-col gap-2 overflow-y-auto">
          {sessions.length === 0 && (
            <p className="text-slate-400">No sessions available</p>
          )}

          {sessions.map((s: Session) => (
            <button
              key={s.id}
              onClick={() => setSelectedSessionID(s.id)}
              className="w-full text-left p-2 rounded bg-slate-700 hover:bg-slate-600 transition"
            >
              <div className="text-sm font-medium">{s.id}</div>
              <div className="text-xs text-slate-300">{s.timestamp}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Map */}
      <div className="flex-1 bg-slate-900">
        <div id="map" className="h-full w-full" />
      </div>

      {/* Session Details */}
      <div className="hidden md:flex md:w-1/4 lg:w-80 flex-col bg-slate-800 p-4 text-white">
        <h2 className="font-semibold mb-4">Session Details</h2>

        {session ? (
          <div className="space-y-4 text-sm">
            <div><b>ID:</b> {session.id}</div>
            <div><b>Started:</b> {session.timestamp}</div>
            <div>
              <b>Start:</b> {session.start_location[0]}, {session.start_location[1]}
            </div>
            <div>
              <b>End:</b> {session.end_location[0]}, {session.end_location[1]}
            </div>

            <hr className="border-slate-600" />

            <div>
              <b>Detected Road Defects:</b>
            </div>

            {rdLoadable.state === "loading" && (
              <p className="text-slate-400">Loading defects…</p>
            )}

            {rdLoadable.state === "hasData" &&
              rdLoadable.data.length === 0 && (
                <p className="text-slate-400">No defects detected</p>
              )}

            {rdLoadable.state === "hasData" && (
              <ul className="space-y-1 max-h-120 overflow-y-auto">
                {rdLoadable.data.map((rd, idx) => {
                  return (
                    <li
                      key={idx}
                      className="p-2 rounded bg-slate-700 text-xs cursor-pointer hover:bg-slate-600 transition"
                      onClick={() => {
                        const marker = rdMarkersRef.current.get(rd.id);
                        if (!marker || !mapRef.current) return;
                        mapRef.current.setView(marker.getLatLng(), 18);
                        marker.openPopup();
                      }}
                    >
                      <div><b>Type:</b> {rd.classification || "Unknown"}</div>
                      <div><b>Location:</b> {rd.location[0]}, {rd.location[1]}</div>
                      <div><b>Status:</b> {rd.fixed ? "Fixed" : "Unfixed"}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-slate-400">Select a session from the left</p>
        )}
      </div>

    </div>
  );
}

export default MapPage;