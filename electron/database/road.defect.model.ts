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

export async function getRoadDefectsBySession(sessionId: number): Promise<RoadDefect[]> {
  const stmt = db.prepare(`SELECT * FROM road_defects WHERE session = ?`);
  return stmt.all(sessionId) as RoadDefect[];
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