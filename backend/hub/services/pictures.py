"""Small avatars derived from HubUser.picture."""

import base64
import io

from PIL import Image

THUMB_EDGE = 96
JPEG_QUALITY = 70


def picture_thumb(picture: str) -> str:
    """Return a list-safe avatar for a stored picture.

    HTTP(S) URLs are already small and are kept as-is. Data-URL photos are
    resized to a short JPEG data-URL. Anything that cannot be decoded becomes
    an empty string.
    """
    raw = (picture or "").strip()
    if not raw:
        return ""
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    if not raw.startswith("data:image") or "," not in raw:
        return ""
    _header, b64 = raw.split(",", 1)
    try:
        blob = base64.b64decode(b64, validate=False)
        img = Image.open(io.BytesIO(blob))
        img = img.convert("RGB")
        img.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    except Exception:
        return ""
    encoded = base64.b64encode(out.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"
