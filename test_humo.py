import requests
import base64

API_KEY = "SG_0b0fc509e15d7b8e"

with open(r"C:\Users\rafca\Downloads\photo_2026-03-01_00-26-27.jpg", "rb") as f:
    img_b64 = base64.b64encode(f.read()).decode()

with open(r"C:\Users\rafca\Downloads\vo_hook (3).mp3", "rb") as f:
    audio_b64 = base64.b64encode(f.read()).decode()

print("Sending request to Segmind HuMo API...")
response = requests.post(
    "https://api.segmind.com/v1/bytedance-humo",
    headers={"x-api-key": API_KEY},
    json={
        "mode": "TIA",
        "image": img_b64,
        "audio": audio_b64,
        "prompt": "A young woman speaking naturally, looking at camera, subtle facial expressions, natural head movement",
        "height": 720,
        "width": 1280,
        "frames": 73,
        "steps": 50,
        "scale_a": 7.5,
        "scale_t": 5.0
    }
)

print(f"Status: {response.status_code}")
if response.status_code == 200:
    with open(r"C:\Users\rafca\Downloads\humo_test.mp4", "wb") as f:
        f.write(response.content)
    print("Salvato: C:\\Users\\rafca\\Downloads\\humo_test.mp4")
else:
    print(f"Errore: {response.text}")
