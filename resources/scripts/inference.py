import socket
import struct
import json
import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

# --- TRACKER IMPORTS ---
# Ensure you have 'tracker' folder with __init__.py in the same directory
from tracker.byte_tracker import BYTETracker

# --- CONFIGURATION ---
UDP_IP = "0.0.0.0"
UDP_PORT = 9123
BUFFER_SIZE = 65535
MODEL_PATH = "./models/1.tflite"

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
            
            # TFLite usually outputs fixed size arrays (e.g., 10 or 25), 
            # we only care about the valid 'count'.
            for i in range(count):
                score = scores[i]
                if score < 0.1: # Filter very low confidence early
                    continue
                
                # TFLite Box: [ymin, xmin, ymax, xmax] (Normalized 0-1)
                ymin, xmin, ymax, xmax = boxes[i]
                
                # Convert to Absolute Pixels (Original Frame Scale)
                # We map directly to original frame size so tracks draw correctly
                x1 = xmin * orig_w
                y1 = ymin * orig_h
                x2 = xmax * orig_w
                y2 = ymax * orig_h
                
                detections.append([x1, y1, x2, y2, score])

            # Convert to numpy array
            detections = np.array(detections)

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
            print(f"Frame Tracks: {len(online_targets)}")
            
            # Optional: Show window (if running on desktop/GUI env)
            # cv2.imshow("Tracking", frame)
            # if cv2.waitKey(1) & 0xFF == ord('q'):
            #     break

except KeyboardInterrupt:
    print("\n[STOPPING]: User Interrupted.")
finally:
    sock.close()
