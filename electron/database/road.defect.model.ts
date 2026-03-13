import db from './db';

export interface RoadDefect {
  road_defects_id: number;
  session: number;
  ave_lat: number;
  ave_lng: number;
  ave_classification: string;
  city: string;
  thumbnail_path: string;
  is_fixed: number;
  is_archived: number;
}

export interface SessionSavePayload {
  session: {
    timestamp: string;
    start_lat: number;
    start_lng: number;
    end_lat: number;
    end_lng: number;
  };
  images: Array<{
    key: string;
    lat: number;
    lng: number;
    timestamp: string;
    img_path: string;
  }>;
  road_defects: Array<{
    key: string;
    ave_lat: number;
    ave_lng: number;
    ave_classification?: string | null;
    city?: string | null;
    thumbnail_path: string;
    is_fixed?: number;
    is_archived?: number;
  }>;
  detections: Array<{
    image_key: string;
    road_defect_key: string;
    bbox: string;
    classification?: string | null;
    calc_lat?: number | null;
    calc_lng?: number | null;
  }>;
}

/**
 * Converts an absolute file system path to a localfile:// URL
 * that the Electron custom protocol handler can serve to the renderer.
 * e.g. "C:\Users\...\4.jpg" → "localfile://C:/Users/.../4.jpg"
 */
function toLocalFileUrl(filePath: string | null | undefined): string | null {
  if (!filePath) return null;
  const normalized = filePath
    .replace(/^file:\/\/\//, '') // strip existing file:/// if any
    .replace(/\\/g, '/');        // normalize Windows backslashes
  return `localfile://file?path=${encodeURIComponent(normalized)}`;
}

export async function getRoadDefectsBySession(sessionId: number): Promise<RoadDefect[]> {
  const stmt = db.prepare(`SELECT * FROM road_defects WHERE session = ?`);
  const rows = stmt.all(sessionId) as RoadDefect[];

  return rows.map((row) => ({
    ...row,
    thumbnail_path: toLocalFileUrl(row.thumbnail_path) ?? row.thumbnail_path,
  }));
}

export async function createRoadDefect(data: Omit<RoadDefect, 'road_defects_id'>) {
  const stmt = db.prepare(`
    INSERT INTO road_defects (
      session,
      ave_lat,
      ave_lng,
      ave_classification,
      city,
      thumbnail_path,
      is_fixed,
      is_archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = stmt.run(
    data.session,
    data.ave_lat,
    data.ave_lng,
    data.ave_classification,
    data.city,
    data.thumbnail_path,
    data.is_fixed || 0,
    data.is_archived || 0
  );
  return info.lastInsertRowid;
}

export async function markRoadDefectFixed(id: number) {
  const stmt = db.prepare(`UPDATE road_defects SET is_fixed = 1 WHERE road_defects_id = ?`);
  stmt.run(id);
}

export async function archiveRoadDefect(id: number) {
  const stmt = db.prepare(`UPDATE road_defects SET is_archived = 1 WHERE road_defects_id = ?`);
  stmt.run(id);
}

export async function getAllSessions() {
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY timestamp DESC');
  return stmt.all();
}

export async function saveSessionWithDetails(payload: SessionSavePayload) {
  const insertSession = db.prepare(`
    INSERT INTO sessions (timestamp, start_lat, start_lng, end_lat, end_lng)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertImage = db.prepare(`
    INSERT INTO images (session, lat, lng, timestamp, img_path)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertRoadDefect = db.prepare(`
    INSERT INTO road_defects (
      session,
      ave_lat,
      ave_lng,
      ave_classification,
      city,
      thumbnail_path,
      is_fixed,
      is_archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDetection = db.prepare(`
    INSERT INTO detections (
      image,
      road_defects,
      bbox,
      classification,
      calc_lat,
      calc_lng
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((data: SessionSavePayload) => {
    const sessionInfo = insertSession.run(
      data.session.timestamp,
      data.session.start_lat,
      data.session.start_lng,
      data.session.end_lat,
      data.session.end_lng
    );
    const sessionId = Number(sessionInfo.lastInsertRowid);

    const imageIdByKey = new Map<string, number>();
    for (const image of data.images) {
      const info = insertImage.run(
        sessionId,
        image.lat,
        image.lng,
        image.timestamp,
        image.img_path
      );
      imageIdByKey.set(image.key, Number(info.lastInsertRowid));
    }

    const roadDefectIdByKey = new Map<string, number>();
    for (const roadDefect of data.road_defects) {
      const info = insertRoadDefect.run(
        sessionId,
        roadDefect.ave_lat,
        roadDefect.ave_lng,
        roadDefect.ave_classification ?? null,
        roadDefect.city ?? null,
        roadDefect.thumbnail_path,
        roadDefect.is_fixed ?? 0,
        roadDefect.is_archived ?? 0
      );
      roadDefectIdByKey.set(roadDefect.key, Number(info.lastInsertRowid));
    }

    for (const detection of data.detections) {
      const imageId = imageIdByKey.get(detection.image_key);
      if (imageId === undefined) {
        throw new Error(`Missing image for detection image_key=${detection.image_key}`);
      }

      const roadDefectId = roadDefectIdByKey.get(detection.road_defect_key);
      if (roadDefectId === undefined) {
        throw new Error(`Missing road_defect for detection road_defect_key=${detection.road_defect_key}`);
      }

      insertDetection.run(
        imageId,
        roadDefectId,
        detection.bbox,
        detection.classification ?? null,
        detection.calc_lat ?? null,
        detection.calc_lng ?? null
      );
    }

    return sessionId;
  });

  console.log("SESSION SAVED")
  return transaction(payload);
}