import db from './db.js';

export function getListOfSessions() {
  const stmt = db.prepare('SELECT * FROM sessions');
  return stmt.all();
}

export function getSessionWithRoadDefects(sessionId) {
  const sessionStmt = db.prepare('SELECT * FROM sessions WHERE session_id = ?');
  const session = sessionStmt.get(sessionId);

  if (!session) return null;

  const rdStmt = db.prepare('SELECT * FROM road_defects WHERE session = ?');
  const roadDefects = rdStmt.all(sessionId);

  return {
    session,
    road_defects: roadDefects
  };
}

export function getAllRoadDefects() {
  const stmt = db.prepare('SELECT * FROM road_defects');
  return stmt.all();
}

export function markRoadDefectFixed(rdId) {
  const stmt = db.prepare('UPDATE road_defects SET fixed = 1 WHERE id = ?');
  stmt.run(rdId);
}

export function archiveRoadDefect(rdId) {
  const stmt = db.prepare('UPDATE road_defects SET archived = 1 WHERE id = ?');
  stmt.run(rdId);
}


