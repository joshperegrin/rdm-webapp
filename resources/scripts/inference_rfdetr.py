import socket
import struct
import json
import cv2
import numpy as np
import os
import sys
import time
import onnxruntime as ort
from tracker.byte_tracker import BYTETracker
from tracker.basetrack import BaseTrack

# --- CONFIGURATION ---
UDP_IP = "0.0.0.0"
UDP_PORT = 9123
BUFFER_SIZE = 65535
MODEL_PATH = "resources/scripts/models/rfdetr.onnx"
DEFAULT_OUTPUT_DIR = "resources/scripts/captures/default"
MODEL_INPUT_SIZE = 576
DEBUG_DUMP_ONCE = True

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
frame_count = 0
timing_accum = {
    "recv": 0.0,
    "parse": 0.0,
    "pre": 0.0,
    "infer": 0.0,
    "post": 0.0,
    "track": 0.0,
    "encode": 0.0,
    "send": 0.0,
    "total": 0.0,
}
timing_report_every = 1
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
sock.settimeout(1.0)
try:
    sock.bind((UDP_IP, UDP_PORT))
    print(f"[LISTENING]: Bound to {UDP_IP}:{UDP_PORT}")
except OSError as e:
    print(f"[ERROR]: {e}")
    exit(1)

# --- ONNX SETUP ---
try:
    providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    available = ort.get_available_providers()
    providers = [p for p in providers if p in available]
    if not providers:
        providers = ["CPUExecutionProvider"]

    session = ort.InferenceSession(MODEL_PATH, providers=providers)
    input_def = session.get_inputs()[0]
    input_name = input_def.name
    input_shape = input_def.shape
    output_defs = session.get_outputs()
    output_names = [o.name for o in output_defs]
    print(f"[INFO]: Model loaded. Providers: {session.get_providers()}")
    print(f"[INFO]: Model input: {input_name} {input_shape}")
    print(f"[INFO]: Model outputs: {output_names}")
except Exception as e:
    print(f"[ERROR]: Could not load ONNX model: {e}")
    exit(1)

def parse_rfdetr_outputs(outputs, orig_w, orig_h, score_thresh=0.1):
    if not outputs:
        return np.empty((0, 5)), np.empty((0, 6))

    boxes = None
    scores = None
    labels = None

    for out in outputs:
        arr = np.asarray(out)
        if arr.ndim == 2 and arr.shape[1] == 4 and boxes is None:
            boxes = arr
        elif arr.ndim in (1, 2) and scores is None:
            flat = arr.reshape(-1)
            if flat.dtype.kind in ("f", "i") and flat.size > 0:
                scores = flat
        elif arr.ndim in (1, 2) and labels is None:
            flat = arr.reshape(-1)
            if flat.dtype.kind in ("i", "u"):
                labels = flat

    if boxes is None:
        return np.empty((0, 5)), np.empty((0, 6))

    if scores is None:
        scores = np.ones((boxes.shape[0],), dtype=np.float32)
    if labels is None:
        labels = np.zeros((boxes.shape[0],), dtype=np.int64)

    if boxes.max() <= 1.5:
        boxes_xyxy = boxes.copy()
        boxes_xyxy[:, 0] *= orig_w
        boxes_xyxy[:, 2] *= orig_w
        boxes_xyxy[:, 1] *= orig_h
        boxes_xyxy[:, 3] *= orig_h
    else:
        boxes_xyxy = boxes

    detections = []
    raw_detections = []
    for i in range(min(len(scores), boxes_xyxy.shape[0], len(labels))):
        score = float(scores[i])
        if score < score_thresh:
            continue
        x1, y1, x2, y2 = boxes_xyxy[i].tolist()
        detections.append([x1, y1, x2, y2, score])
        raw_detections.append([x1, y1, x2, y2, score, int(labels[i])])

    return np.array(detections), np.array(raw_detections)

# --- MAIN LOOP ---
try: 
    while True:
        frame_start = time.perf_counter()
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
        sock.settimeout(1.0)

        if latest_data is None:
            try:
                data, addr = sock.recvfrom(BUFFER_SIZE)
            except socket.timeout:
                print("[INFO]: Waiting for UDP frames on 0.0.0.0:9123")
                continue
        else:
            data, addr = latest_data, latest_addr

        if len(data) < 3: continue
        timing_accum["recv"] += time.perf_counter() - frame_start

        # --- 2. Parse Packet ---
        t0 = time.perf_counter()
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
        timing_accum["parse"] += time.perf_counter() - t0

        # --- 3. Pre-process for Model ---
        t0 = time.perf_counter()
        orig_h, orig_w = frame.shape[:2]
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        # Determine input layout/size from model if available.
        if isinstance(input_shape, (list, tuple)) and len(input_shape) == 4:
            if input_shape[1] == 3:
                input_layout = "NCHW"
                input_h = input_shape[2] if isinstance(input_shape[2], int) else MODEL_INPUT_SIZE
                input_w = input_shape[3] if isinstance(input_shape[3], int) else MODEL_INPUT_SIZE
            elif input_shape[3] == 3:
                input_layout = "NHWC"
                input_h = input_shape[1] if isinstance(input_shape[1], int) else MODEL_INPUT_SIZE
                input_w = input_shape[2] if isinstance(input_shape[2], int) else MODEL_INPUT_SIZE
            else:
                input_layout = "NHWC"
                input_h = MODEL_INPUT_SIZE
                input_w = MODEL_INPUT_SIZE
        else:
            input_layout = "NHWC"
            input_h = MODEL_INPUT_SIZE
            input_w = MODEL_INPUT_SIZE

        input_data = cv2.resize(rgb_frame, (input_w, input_h))
        input_data = input_data.astype(np.float32) / 255.0
        if input_layout == "NCHW":
            input_data = np.transpose(input_data, (2, 0, 1))
        input_data = np.expand_dims(input_data, axis=0)
        timing_accum["pre"] += time.perf_counter() - t0

        # --- 4. Run Inference ---
        t0 = time.perf_counter()
        outputs = session.run(output_names, {input_name: input_data})
        if DEBUG_DUMP_ONCE:
            print("[DEBUG]: RFDETR raw outputs (first dump only)")
            for i, out in enumerate(outputs):
                arr = np.asarray(out)
                flat = arr.reshape(-1)
                preview = flat[:20].tolist()
                print(f"[DEBUG]: out[{i}] shape={arr.shape} dtype={arr.dtype} sample={preview}")
            DEBUG_DUMP_ONCE = False
        timing_accum["infer"] += time.perf_counter() - t0

        t0 = time.perf_counter()
        detections, raw_detections = parse_rfdetr_outputs(outputs, orig_w, orig_h)
        timing_accum["post"] += time.perf_counter() - t0

        # --- 5. Update Tracker ---
        t0 = time.perf_counter()
        online_targets = []
        if len(detections) > 0:
            online_targets = tracker.update(
                detections, 
                [orig_h, orig_w], 
                [orig_h, orig_w] 
            )
        timing_accum["track"] += time.perf_counter() - t0
        
        # --- 6. Prepare Payload Data ---
        t0 = time.perf_counter()
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
        timing_accum["post"] += time.perf_counter() - t0

        # --- 7. Construct Response Packet ---
        t0 = time.perf_counter()
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
        timing_accum["encode"] += time.perf_counter() - t0

        # Send back to Electron
        t0 = time.perf_counter()
        if payload and addr:
            sock.sendto(payload, addr)
        timing_accum["send"] += time.perf_counter() - t0

        timing_accum["total"] += time.perf_counter() - frame_start
        frame_count += 1
        if frame_count % timing_report_every == 0:
            denom = float(timing_report_every)
            print(
                "[TIMING ms/frame] "
                f"recv={timing_accum['recv']/denom*1000:.1f} "
                f"parse={timing_accum['parse']/denom*1000:.1f} "
                f"pre={timing_accum['pre']/denom*1000:.1f} "
                f"infer={timing_accum['infer']/denom*1000:.1f} "
                f"post={timing_accum['post']/denom*1000:.1f} "
                f"track={timing_accum['track']/denom*1000:.1f} "
                f"encode={timing_accum['encode']/denom*1000:.1f} "
                f"send={timing_accum['send']/denom*1000:.1f} "
                f"total={timing_accum['total']/denom*1000:.1f}"
            )
            for k in timing_accum:
                timing_accum[k] = 0.0

except KeyboardInterrupt:
    print("\n[STOPPING]: User Interrupted.")
finally:
    sock.close()
