import socket
import struct
import json
import cv2
import numpy as np
from ai_edge_litert.interpreter import Interpreter

UDP_IP = "0.0.0.0"
UDP_PORT = 9123
BUFFER_SIZE = 65535
MODEL_PATH = "./models/1.tflite"


# INITALIZE UDP LISTENER
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    sock.bind((UDP_IP, UDP_PORT))
    print(f"[LISTENING]: Bound to {UDP_IP}: {UDP_PORT}")
except OSError as e:
    print(f"[ERROR]: {e}")
    exit(1)


# Initialize TFLITE
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



try: 
    while True:
        # Decode Incoming Data
        data, addr = sock.recvfrom(BUFFER_SIZE)
        if len(data) < 3:
            continue

        is_live_preview = data[0] == 1 # is_live_preview

        json_len = struct.unpack("!H", data[1:3])[0]
        json_start = 3
        json_end = json_start + json_len
        json_bytes = data[json_start:json_end]

        gps_data = json.loads(json_bytes.decode('utf-8')) # GPS data 
        image_bytes = data[json_end:] # image data
        
        # Prepare Data for Inference
        np_arr = np.frombuffer(image_bytes, dtype=np.uint8)
        frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

        if frame is not None:
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            input_data = cv2.resize(rgb_frame, (input_width, input_height))
            input_data = np.expand_dims(input_data, axis=0)

            if input_details[0]['dtype'] == np.float32:
                input_data = (np.float32(input_data) - 127.5) / 127.5

            interpreter.set_tensor(input_details[0]['index'], input_data)
            interpreter.invoke() # Run Inference
            
            boxes = interpreter.get_tensor(output_details[0]['index'])[0] # Bounding box coords
            classes = interpreter.get_tensor(output_details[1]['index'])[0] # Class index
            scores = interpreter.get_tensor(output_details[2]['index'])[0] # Confidence
            count = interpreter.get_tensor(output_details[3]['index'])[0] # Number of detections

            print(boxes)
            print("\n")
            print(classes)
            print("\n")
            print(scores)
            print("\n")
            print(count)
            print("\n\n\n")

except KeyboardInterrupt:
    print("\n[STOPPING]: User Interrupted.")
finally:
    sock.close()
    
