-- sessions table
CREATE TABLE IF NOT EXISTS sessions (
    session_id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    start_lat REAL NOT NULL,
    start_lng REAL NOT NULL,
    end_lat REAL NOT NULL,
    end_lng REAL NOT NULL
);

-- road defects table
CREATE TABLE IF NOT EXISTS road_defects (
    road_defects_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session INTEGER NOT NULL,
    ave_lat REAL NOT NULL,
    ave_lng REAL NOT NULL,
    ave_classification TEXT,
    city TEXT,
    thumbnail_path TEXT NOT NULL,
    is_fixed INTEGER DEFAULT 0,
    is_archived INTEGER DEFAULT 0,
    FOREIGN KEY (session) REFERENCES sessions(session_id)
);

-- images table
CREATE TABLE IF NOT EXISTS images (
    image_id INTEGER PRIMARY KEY AUTOINCREMENT,
    session INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    timestamp TEXT NOT NULL,
    img_path TEXT NOT NULL,
    FOREIGN KEY(session) REFERENCES sessions(session_id)
);

-- detections table
CREATE TABLE IF NOT EXISTS detections (
    detection_id INTEGER PRIMARY KEY AUTOINCREMENT,
    image INTEGER NOT NULL,
    road_defects INTEGER NOT NULL,
    bbox TEXT NOT NULL,
    classification TEXT,
    calc_lat REAL,
    calc_lng REAL,
    FOREIGN KEY(image) REFERENCES images(image_id),
    FOREIGN KEY(road_defects) REFERENCES road_defects(road_defects_id)
);
