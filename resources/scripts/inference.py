import socket
import struct
import json

UDP_IP = "0.0.0.0"
UDP_PORT = 9123
BUFFER_SIZE = 65535

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind((UDP_IP, UDP_PORT))



while True:
    data, addr = sock.recvfrom(BUFFER_SIZE)
    print(data)

    if len(data) < 3:
        continue

    is_live_preview = data[0] == 1

    json_len = struct.unpack("!H", data[1:3])[0]

    json_start = 3
    json_end = json_start + json_len

    json_bytes = data[json_start:json_end]
    gps_data = json.loads(json_bytes.decode('utf-8'))
    
    image_bytes = data[json_end:]

    print(f"Preview: {is_live_preview} | Coords: {gps_data} | Img Size: {len(image_bytes)}")
