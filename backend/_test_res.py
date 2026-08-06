import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
django.setup()

from rest_framework.test import APIClient

c = APIClient()
r = c.post(
    "/api/auth/login/",
    {"username": "admin@cotg.local", "password": "admin123"},
    format="json",
)
token = r.data["access"]
c.credentials(HTTP_AUTHORIZATION="Bearer " + token)

f = c.post(
    "/api/resource-folders/",
    {"name": "Safety", "kind": "documents", "sort_order": 1},
    format="json",
)
print("folder", f.status_code, f.data)

d = c.post(
    "/api/documents/",
    {
        "title": "Safety Policy",
        "folder_id": f.data["id"],
        "visible_positions": ["Team Leader"],
        "allow_download": False,
        "allow_copy": False,
        "file_path": "",
        "file_name": "",
        "file_type": "",
        "file_size": 0,
    },
    format="json",
)
print("doc", d.status_code, d.data)

a = c.get("/api/documents/?position=Team%20Leader")
b = c.get("/api/documents/?position=Supervisor")
print("filter TL", a.status_code, len(a.data), [x["title"] for x in a.data])
print("filter Sup", b.status_code, len(b.data), [x["title"] for x in b.data])
