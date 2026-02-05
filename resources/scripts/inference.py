import socket
import struct
import json
import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

# --- TRACKER IMPORTS ---
from tracker.byte_tracker import BYTETracker

# --- CONFIGURATION ---
UDP_IP = "0.0.0.0"
UDP_PORT = 9123
BUFFER_SIZE = 65535
MODEL_PATH = "./models/1.tflite"

def get_iou(box1, box2):
    """
    Calculates IoU between two bounding boxes (x1, y1, x2, y2).
    """
    xx1 = max(box1[0], box2[0])
    yy1 = max(box1[1], box2[1])
    xx2 = min(box1[2], box2[2])
    yy2 = min(box1[3], box2[3])

    w = max(0, xx2 - xx1)
    h = max(0, yy2 - yy1)
    
    intersection = w * h
    area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union = area1 + area2 - intersection

    return intersection / union if union > 0 else 0 

# ByteTrack requires an arguments object to initialize
class TrackerArgs:
    def __init__(self):
        self.track_thresh = 0.5  # Detection confidence threshold
        self.track_buffer = 30   # Frames to keep lost tracks
        self.match_thresh = 0.8  # Matching threshold
        self.mot20 = False       # Set True if using MOT20 (usually False for custom)

# Initialize Tracker
tracker_args = TrackerArgs()
tracker = BYTETracker(tracker_args, frame_rate=30)

# --- NETWORK SETUP ---
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    sock.bind((UDP_IP, UDP_PORT))
    print(f"[LISTENING]: Bound to {UDP_IP}:{UDP_PORT}")
except OSError as e:
    print(f"[ERROR]: {e}")
    exit(1)

# --- TFLITE SETUP ---
try:
    interpreter = Interpreter(model_path=MODEL_PATH)
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    _, input_height, input_width, _ = input_details[0]['shape']
    print(f"[INFO]: Model loaded. Expected input: {input_width}x{input_height}")
except Exception as e:
    print(f"[ERROR]: Could not load TFLite model: {e}")
    exit(1)

# --- MAIN LOOP ---
try: 
    while True:
        # 1. Receive Data
        data, addr = sock.recvfrom(BUFFER_SIZE)
        if len(data) < 3:
            continue

        is_live_preview = data[0] == 1 
        json_len = struct.unpack("!H", data[1:3])[0]
        json_start = 3
        json_end = json_start + json_len
        
        # Parse inputs
        # gps_data = json.loads(data[json_start:json_end].decode('utf-8')) 
        image_bytes = data[json_end:]
        
        np_arr = np.frombuffer(image_bytes, dtype=np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if frame is not None:
            # 2. Pre-process for Model
            orig_h, orig_w = frame.shape[:2]
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            # Note: plain resize stretches the image. 
            # Ideally, use letterbox if your model was trained that way.
            input_data = cv2.resize(rgb_frame, (input_width, input_height))
            input_data = np.expand_dims(input_data, axis=0)

            if input_details[0]['dtype'] == np.float32:
                input_data = (np.float32(input_data) - 127.5) / 127.5

            # 3. Run Inference
            interpreter.set_tensor(input_details[0]['index'], input_data)
            interpreter.invoke()
            
            boxes = interpreter.get_tensor(output_details[0]['index'])[0] # [ymin, xmin, ymax, xmax]
            classes = interpreter.get_tensor(output_details[1]['index'])[0] 
            scores = interpreter.get_tensor(output_details[2]['index'])[0] 
            count = int(interpreter.get_tensor(output_details[3]['index'])[0])



            # 4. Format Detections for ByteTrack
            # ByteTrack expects: [[x1, y1, x2, y2, score], ...] in ABSOLUTE pixels
            
            detections = []
            raw_detections = []

            # TFLite usually outputs fixed size arrays (e.g., 10 or 25), 
            # we only care about the valid 'count'.
            for i in range(count):
                score = scores[i]
                if score < 0.1: # Filter very low confidence early
                    continue
                
                # TFLite Box: [ymin, xmin, ymax, xmax] (Normalized 0-1)
                class_id = int(classes[i])

                ymin, xmin, ymax, xmax = boxes[i]
                
                # Convert to Absolute Pixels (Original Frame Scale)
                # We map directly to original frame size so tracks draw correctly
                x1 = xmin * orig_w
                y1 = ymin * orig_h
                x2 = xmax * orig_w
                y2 = ymax * orig_h
                
                detections.append([x1, y1, x2, y2, score])
                raw_detections.append([x1, y1, x2, y2, score, class_id])

            # Convert to numpy array
            detections = np.array(detections)
            raw_detections = np.array(raw_detections)

            # 5. Update Tracker
            # We pass (orig_h, orig_w) for both img_info and img_size. 
            # This forces the tracker's internal scaling factor to 1.0, 
            # since we already scaled the boxes manually above.
            online_targets = []
            if len(detections) > 0:
                online_targets = tracker.update(
                    detections, 
                    [orig_h, orig_w], 
                    [orig_h, orig_w] 
                )
            
            # 6. Process/Visualize Tracks
            for t in online_targets:
                track_box = t.tlbr
                best_iou = 0
                best_class = -1

                if len(raw_detections) > 0:
                    for rd in raw_detections:
                        det_box = rd[:4]
                        det_class = int(rd[5])

                        iou = get_iou(track_box, det_box)

                        if iou > 0.5 and iou > best_iou:
                            best_iou = iou
                            best_class = det_class

                if best_class != -1:
                    t.class_id = best_class

                current_class = getattr(t, 'class_id', -1)

                x1, y1, x2, y2 = map(int, track_box)

                color = (0, 255, 0)

                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

                label = f"ID: {t.track_id} | Class: {current_class}"

                (w, h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)
                cv2.rectangle(frame, (x1, y1 - 20), (x1 + w, y1), color, -1)

                cv2.putText(frame, label, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)
                
                print(f"ID: {t.track_id} | Class: {current_class} | Box: {track_box}")

            if len(raw_detections) > 0:
                cv2.imwrite("latest_inference.jpg", frame)
            print(f"Frame Tracks: {len(online_targets)}")
            
            # Optional: Show window (if running on desktop/GUI env)
            # cv2.imshow("Tracking", frame)
            # if cv2.waitKey(1) & 0xFF == ord('q'):
            #     break

except KeyboardInterrupt:
    print("\n[STOPPING]: User Interrupted.")
finally:
    sock.close()
