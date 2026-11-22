"""Render a preview image of the Windows week layout (test mode, no sync)."""
import os
import sys
from datetime import date, timedelta
from pathlib import Path

os.environ["NOTITIES_TEST"] = "1"
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "windows"))

import tkinter as tk  # noqa: E402
from PIL import ImageGrab  # noqa: E402
import notities  # noqa: E402
from notities_core import normalize_templates  # noqa: E402

root = tk.Tk()
w = min(root.winfo_screenwidth(), 1600)
h = min(root.winfo_screenheight(), 900)
root.geometry(f"{w}x{h}+40+40")
app = notities.App(root)

# Demo content only, never written to disk.
monday = date.today() - timedelta(days=date.today().weekday())
samples = {
    "08:00": "Team stand-up",
    "09:30": "Design review",
    "13:00": "Lunch",
    "16:30": "Gym",
}
for i in range(7):
    key = (monday + timedelta(days=i)).isoformat()
    day = {"notes": {"text": "", "ts": 0}, "slots": {}}
    for time_key, text in samples.items():
        if i < 5:
            day["slots"][time_key] = {"text": text, "ts": 1}
    if i == 4:
        day["notes"] = {"text": "Pick up groceries", "ts": 1}
    app.days[key] = day
# Show a recurring hint in the empty Wednesday 11:00 slot.
app.templates = normalize_templates({
    "demo-weekly": {
        "id": "demo-weekly", "text": "Client call", "time": "11:00",
        "repeat": "weekly", "weekday": 2, "ts": 1, "deleted": False,
    }
})
app.render()
# Raise above any floating menu so the screenshot contains only the app.
root.lift()
root.attributes("-topmost", True)
root.focus_force()
root.update()

bbox = (root.winfo_rootx(), root.winfo_rooty(),
        root.winfo_rootx() + root.winfo_width(),
        root.winfo_rooty() + root.winfo_height())
out = ROOT / "windows-preview.png"
ImageGrab.grab(bbox=bbox).save(out)
print(out, root.winfo_width(), root.winfo_height())
root.destroy()
