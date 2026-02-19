import socket
import struct
import json
import cv2
import numpy as np
import os
import sys
from ai_edge_litert.interpreter import Interpreter
from tracker.byte_tracker import BYTETracker
from tracker.basetrack import BaseTrack

# --- CONFIGURATION ---
UDP_IP = "0.0.0.0"
UDP_PORT = 9123
BUFFER_SIZE = 65535
# MODEL_PATH = "./models/1.tflite"
# DEFAULT_OUTPUT_DIR = "./captures/default"
MODEL_PATH = "resources/scripts/models/1.tflite"
DEFAULT_OUTPUT_DIR = "resources/scripts/captures/default"

def get_iou(box1, box2):
    """ Calculates IoU between two bounding boxes (x1, y1, x2, y2). """
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

class TrackerArgs:
    def __init__(self):
        self.track_thresh = 0.5  # Detection confidence threshold
        self.track_buffer = 30   # Frames to keep lost tracks
        self.match_thresh = 0.8  # Matching threshold
        self.mot20 = False

tracker_args = TrackerArgs()
tracker = BYTETracker(tracker_args, frame_rate=30)
saved_frame_count = 0
output_base_dir = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUTPUT_DIR
frames_dir = os.path.join(output_base_dir, "frames")
crops_dir = os.path.join(output_base_dir, "crops")
os.makedirs(frames_dir, exist_ok=True)
os.makedirs(crops_dir, exist_ok=True)
print(f"[INFO]: Saving detected frames to {frames_dir}")
print(f"[INFO]: Saving detected crops to {crops_dir}")

def reset_tracker():
    global tracker
    BaseTrack._count = 0
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
        # --- 1. Receive & Drain Buffer ---
        latest_data = None
        latest_addr = None
        sock.setblocking(False)
        try:
            while True:
                data, addr = sock.recvfrom(BUFFER_SIZE)
                if len(data) > 0 and (data[0] & 0x02) == 0x02:
                    latest_data = data
                    latest_addr = addr
                    break
                latest_data = data
                latest_addr = addr
        except BlockingIOError:
            pass
        sock.setblocking(True)

        if latest_data is None:
            data, addr = sock.recvfrom(BUFFER_SIZE)
        else:
            data, addr = latest_data, latest_addr

        if len(data) < 3: continue

        # --- 2. Parse Packet ---
        # Byte 0 is the flag from Electron (bit0 = preview, bit1 = stop/reset)
        is_live_preview = (data[0] & 0x01) == 0x01
        stop_requested = (data[0] & 0x02) == 0x02

        if stop_requested:
            reset_tracker()
            continue
        
        # Byte 1-2 is JSON length of the original Pi packet
        json_len = struct.unpack("!H", data[1:3])[0]
        
        # Extract Image (Skip Byte 0, Byte 1-2, and JSON)
        image_bytes = data[3 + json_len:]
        
        np_arr = np.frombuffer(image_bytes, dtype=np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if frame is None: continue
        frame_for_saving = frame.copy()

        # --- 3. Pre-process for Model ---
        orig_h, orig_w = frame.shape[:2]
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        input_data = cv2.resize(rgb_frame, (input_width, input_height))
        input_data = np.expand_dims(input_data, axis=0)

        if input_details[0]['dtype'] == np.float32:
            input_data = (np.float32(input_data) - 127.5) / 127.5

        # --- 4. Run Inference ---
        interpreter.set_tensor(input_details[0]['index'], input_data)
        interpreter.invoke()
        
        boxes = interpreter.get_tensor(output_details[0]['index'])[0] 
        classes = interpreter.get_tensor(output_details[1]['index'])[0] 
        scores = interpreter.get_tensor(output_details[2]['index'])[0] 
        count = int(interpreter.get_tensor(output_details[3]['index'])[0])

        detections = []
        raw_detections = []

        for i in range(count):
            score = scores[i]
            if score < 0.1: continue
            
            ymin, xmin, ymax, xmax = boxes[i]
            x1, y1, x2, y2 = xmin * orig_w, ymin * orig_h, xmax * orig_w, ymax * orig_h
            
            detections.append([x1, y1, x2, y2, score])
            raw_detections.append([x1, y1, x2, y2, score, int(classes[i])])

        detections = np.array(detections)
        raw_detections = np.array(raw_detections)

        # --- 5. Update Tracker ---
        online_targets = []
        if len(detections) > 0:
            online_targets = tracker.update(
                detections, 
                [orig_h, orig_w], 
                [orig_h, orig_w] 
            )
        
        # --- 6. Prepare Payload Data ---
        tracked_objects = []

        for t in online_targets:
            track_box = t.tlbr
            
            # Match tracker ID to original Class ID via IoU
            best_iou = 0
            best_class = -1

            if len(raw_detections) > 0:

                for rd in raw_detections:
                    iou = get_iou(track_box, rd[:4])
                    if iou > 0.5 and iou > best_iou:
                        best_iou = iou
                        best_class = int(rd[5])

            if best_class != -1:
                t.class_id = best_class

            current_class = getattr(t, 'class_id', -1)

            # Add to list for Electron
            tracked_objects.append({
                "id": int(t.track_id),
                "class": int(current_class),
                "box": [float(x) for x in track_box] # [x1, y1, x2, y2]
            })
            print(f"ID: {t.track_id} | Class: {current_class} | Box: {track_box}") 

            # Save crop for each tracked object using tracking ID as filename.
            x1, y1, x2, y2 = map(int, track_box)
            x1 = max(0, min(x1, orig_w - 1))
            y1 = max(0, min(y1, orig_h - 1))
            x2 = max(0, min(x2, orig_w))
            y2 = max(0, min(y2, orig_h))
            if x2 > x1 and y2 > y1:
                crop = frame_for_saving[y1:y2, x1:x2]
                if crop.size > 0:
                    crop_path = os.path.join(crops_dir, f"{int(t.track_id)}.jpg")
                    cv2.imwrite(crop_path, crop)

            # Only Draw if Preview is Requested
            if is_live_preview:
                x1, y1, x2, y2 = map(int, track_box)
                color = (0, 255, 0)
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                
                label = f"ID: {t.track_id}"
                cv2.putText(frame, label, (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)

        # --- 7. Construct Response Packet ---
        frame_path = None
        if len(tracked_objects) > 0:
            saved_frame_count += 1
            frame_path = os.path.join(frames_dir, f"frame-{saved_frame_count}.jpg")
            cv2.imwrite(frame_path, frame_for_saving)

        payload_obj = {
            "frame_path": frame_path,
            "detections": tracked_objects
        }

        json_str = json.dumps(payload_obj)
        json_bytes = json_str.encode('utf-8')
        json_length = len(json_bytes)
        
        payload = b''

        if is_live_preview:
            # FLAG 0x02 = JSON + Image
            ret, encoded_img = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if ret:
                # Protocol: [FLAG(1)] [JSON_LEN(2)] [JSON] [IMAGE]
                header_pack = struct.pack("!BH", 0x02, json_length)
                payload = header_pack + json_bytes + encoded_img.tobytes()
        else:
            # FLAG 0x01 = JSON Only (No image overhead)
            # Protocol: [FLAG(1)] [JSON_LEN(2)] [JSON]
            header_pack = struct.pack("!BH", 0x01, json_length)
            payload = header_pack + json_bytes

        # Send back to Electron
        if payload and addr:
            sock.sendto(payload, addr)

except KeyboardInterrupt:
    print("\n[STOPPING]: User Interrupted.")
finally:
    sock.close()
