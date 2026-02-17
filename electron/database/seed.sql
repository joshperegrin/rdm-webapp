-- SESSIONS
INSERT INTO sessions (timestamp, start_lat, start_lng, end_lat, end_lng)
VALUES 
('2025-01-10 08:30:00', 14.444134, 120.953242, 14.445500, 120.954800),
('2025-01-11 09:15:00', 14.440000, 120.950000, 14.448000, 120.960000);

-- IMAGES
INSERT INTO images (session, lat, lng, timestamp, img_path)
VALUES
(1, 14.444200, 120.953300, '2025-01-10 08:32:10', 'images/session1_img1.jpg'),
(1, 14.444800, 120.953900, '2025-01-10 08:35:22', 'images/session1_img2.jpg'),
(2, 14.441200, 120.951100, '2025-01-11 09:18:45', 'images/session2_img1.jpg');

-- ROAD DEFECTS
INSERT INTO road_defects (
    session,
    ave_lat,
    ave_lng,
    ave_classification,
    city,
    thumbnail_path,
    is_fixed,
    is_archived
)
VALUES
(1, 14.444210, 120.953317, 'Pothole', 'Malabon', 'thumbnails/rd1.jpg', 0, 0),
(1, 14.444810, 120.953920, 'Crack', 'Mandaluyong', 'thumbnails/rd2.jpg', 1, 0),
(2, 14.441210, 120.951120, 'Alligator Crack', 'Gensan', 'thumbnails/rd3.jpg', 0, 0);

-- DETECTIONS
INSERT INTO detections (
    image,
    road_defects,
    bbox,
    classification,
    calc_lat,
    calc_lng
)
VALUES
(1, 1, '[120,45,200,150]', 'Pothole', 14.444210, 120.953315),
(2, 2, '[80,30,160,110]', 'Crack', 14.444810, 120.953910),
(3, 3, '[50,40,180,160]', 'Alligator Crack', 14.441210, 120.951127);
