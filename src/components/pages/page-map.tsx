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

function MapPage() {
  const [sessions] = useAtom(recentSessionsAtom);
  const [, setSelectedSessionID] = useAtom(selectedSessionID);
  const [session] = useAtom(selectedSession);
  const [rdLoadable] = useAtom(selectedSession_RD_loadable);
  const mapRef = useRef<L.Map | null>(null);
  const rdLayerRef = useRef<L.LayerGroup | null>(null);
  const rdMarkersRef = useRef<Map<string, L.Marker>>(new Map());

  /* Placeholder functions for future implementation */
  const markRoadDefectFixed = (rdId: string) => {
    console.log("Mark Fixed:", rdId);
    // TODO: Call backend or update state
  };

  const archiveRoadDefect = (rdId: string) => {
    console.log("Archive:", rdId);
    // TODO: Call backend or update state
  };

  useEffect(() => {
    if (mapRef.current) return;

    mapRef.current = L.map("map");

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(mapRef.current);

    rdLayerRef.current = L.layerGroup().addTo(mapRef.current);

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      rdLayerRef.current = null;
      rdMarkersRef.current.clear();
    };
  }, []);

  /* markers */
  useEffect(() => {
    if (!mapRef.current || !rdLayerRef.current) return;

    rdLayerRef.current.clearLayers();
    rdMarkersRef.current.clear();

    let rdList: any[] = [];

    if (rdLoadable.state === "hasData") {
      rdList = rdLoadable.data;
    }

    if (!session) {
      sessions.forEach((s: any) => {
        if (s.road_defects) {
          rdList.push(...s.road_defects);
        }
      });
    }

    if (rdList.length === 0) return;

    const bounds = L.latLngBounds([]);

    rdList.forEach((rd) => {
      const [lat, lng] = rd.location;

      if (lat === 0 || lng === 0 || Number.isNaN(lat) || Number.isNaN(lng)) return;

      const marker = L.marker([lat, lng], {
        icon: L.icon({
          iconUrl:
            "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png",
          shadowUrl:
            "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
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

      bounds.extend([lat, lng]);
    });

    if (bounds.isValid()) {
      mapRef.current.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [rdLoadable]);

  return (
    <div className="flex h-full w-full">

      {/* Select Session */}
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
                    >
                      <div><b>Type:</b> {rd.classification || "Unknown"}</div>
                      <div><b>Location:</b> {rd.location[0]}, {rd.location[1]}</div>
                      <div><b>Status:</b> {rd.fixed ? "Fixed" : "Unfixed"}</div>

                      {/* Archive & Fixed buttons */}
                      {/*<div className="flex gap-2 mt-1">
                        {!rd.fixed && (
                          <button
                            className="px-2 py-1 text-xs bg-green-600 rounded hover:bg-green-500"
                            onClick={() => markRoadDefectFixed(rd.id)}
                          >
                            Mark Fixed
                          </button>
                        )}
                        {!rd.archived && (
                          <button
                            className="px-2 py-1 text-xs bg-red-600 rounded hover:bg-red-500"
                            onClick={() => archiveRoadDefect(rd.id)}
                          >
                            Archive
                          </button>
                        )}
                      </div>*/}
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
