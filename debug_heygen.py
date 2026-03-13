import requests
import json

key = "sk_V2_hgu_kvH4RENRflO_mrZNuSY73cY5H84M0wHiDO6X730XyLc0"
url = "https://api.heygen.com/v1/video.list"
res = requests.get(url, headers={"X-Api-Key": key}, timeout=15)

print(f"Status: {res.status_code}")
try:
    print("Relevant Headers:", {k:v for k,v in res.headers.items() if any(x in k.lower() for x in ['quota', 'credit', 'limit', 'remain'])})
    data = res.json()
    print(json.dumps(data, indent=2)[:400])
except Exception as e:
    print(f"Error: {e}")
