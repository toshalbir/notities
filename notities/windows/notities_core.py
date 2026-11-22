"""Shared logic for the Windows agenda.

The data format is the same as the iOS app (notities/agenda.json on GitHub),
so both apps can update each other. Each field keeps a timestamp (ms):
on conflict, the most recent change wins.
"""
from __future__ import annotations

import base64
import json
import os
import re
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib import error, parse, request

APP_NAME = "Notities"
SCHEMA = 1

WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

TIMES = [f"{m // 60:02d}:{m % 60:02d}" for m in range(6 * 60, 20 * 60 + 1, 30)]


def bucket_time(value: object) -> str | None:
    """Map any HH:MM slot (including old 15-minute keys) onto the half-hour grid."""
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"(\d{1,2}):(\d{2})", value)
    if not match:
        return None
    minutes = int(match.group(1)) * 60 + int(match.group(2))
    bucket = (minutes // 30) * 30
    if bucket < 6 * 60 or bucket > 20 * 60:
        return None
    return f"{bucket // 60:02d}:{bucket % 60:02d}"


class GitHubError(Exception):
    """Error when talking to the GitHub REST API."""


# ---------- Dates ----------

def now_ms() -> int:
    return int(time.time() * 1000)


def iso_day(value: date) -> str:
    return value.isoformat()


def parse_day(key: str) -> date:
    try:
        return date.fromisoformat(key)
    except (ValueError, TypeError):
        return date.today()


def valid_day(key: object) -> bool:
    if not isinstance(key, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", key):
        return False
    try:
        return date.fromisoformat(key).isoformat() == key
    except ValueError:
        return False


def monday(value: date) -> date:
    return value - timedelta(days=value.weekday())


def day_number(value: date) -> int:
    return value.timetuple().tm_yday


def iso_week(value: date) -> int:
    return value.isocalendar().week


def long_date(value: date) -> str:
    return f"{value.day} {MONTHS[value.month - 1]} {value.year}"


def weekday_name(value: date) -> str:
    return WEEKDAYS[(value.weekday() + 1) % 7]


def short_weekday(value: date) -> str:
    return WEEKDAYS_SHORT[(value.weekday() + 1) % 7]


def short_month(value: date) -> str:
    return MONTHS_SHORT[value.month - 1]


# ---------- Data ----------

def normalize_field(value: object) -> dict:
    if isinstance(value, str):  # old version: plain text
        return {"text": value, "ts": 0}
    if isinstance(value, dict):
        text = value.get("text")
        ts = value.get("ts", 0)
        try:
            ts = int(ts)
        except (TypeError, ValueError):
            ts = 0
        return {
            "text": text if isinstance(text, str) else "",
            "ts": ts,
            "done": bool(value.get("done", False)),
        }
    return {"text": "", "ts": 0, "done": False}


def normalize_hidden(value: object) -> dict:
    """Per-day suppressions of recurring items: {template_id: timestamp}."""
    result = {}
    if isinstance(value, dict):
        for key, stamp in value.items():
            item_id = str(key).strip()
            if not item_id:
                continue
            try:
                result[item_id] = int(stamp)
            except (TypeError, ValueError):
                continue
    return result


def normalize_entry(value: object) -> dict:
    if isinstance(value, str):
        return {"notes": {"text": value, "ts": 0}, "slots": {}, "hidden": {}}
    obj = value if isinstance(value, dict) else {}
    slots = {}
    raw_slots = obj.get("slots")
    if isinstance(raw_slots, dict):
        for time_key, field in raw_slots.items():
            bucket = bucket_time(time_key)
            if bucket is None:
                continue
            incoming = normalize_field(field)
            current = slots.get(bucket)
            if current is None or incoming["ts"] > current["ts"]:
                slots[bucket] = incoming
    return {
        "notes": normalize_field(obj.get("notes")),
        "slots": slots,
        "hidden": normalize_hidden(obj.get("hidden")),
    }


def has_content(entry: dict) -> bool:
    clean = normalize_entry(entry)
    return (
        bool(clean["notes"]["text"].strip())
        or bool(clean["hidden"])
        or any(field["text"].strip() or field["done"] for field in clean["slots"].values())
    )


# ---------- Recurring items ----------

def normalize_template(value: object) -> dict | None:
    """Normalize one recurring item. Returns None for unusable input."""
    if not isinstance(value, dict):
        return None
    item_id = str(value.get("id") or "").strip()
    text = str(value.get("text") or "").strip()
    if not item_id or not text:
        return None
    try:
        ts = int(value.get("ts", 0))
    except (TypeError, ValueError):
        ts = 0
    repeat = "monthly" if value.get("repeat") == "monthly" else "weekly"
    try:
        weekday = int(value.get("weekday", 0))
    except (TypeError, ValueError):
        weekday = 0
    try:
        day = int(value.get("day", 1))
    except (TypeError, ValueError):
        day = 1
    time_key = bucket_time(value.get("time")) or "09:00"
    return {
        "id": item_id,
        "text": text,
        "time": time_key,
        "repeat": repeat,
        "weekday": weekday % 7,          # 0 = Monday
        "day": -1 if day == -1 else min(31, max(1, day)),
        "ts": ts,
        "deleted": bool(value.get("deleted", False)),
    }


def normalize_templates(value: object) -> dict:
    if not isinstance(value, dict):
        return {}
    result = {}
    for raw in value.values():
        item = normalize_template(raw)
        if item is not None:
            result[item["id"]] = item
    return result


def merge_templates(local: dict, remote: object) -> bool:
    """Merge recurring items by id; newest timestamp wins, tombstones stay."""
    changed = False
    for raw in (remote or {}).values() if isinstance(remote, dict) else []:
        item = normalize_template(raw)
        if item is None:
            continue
        current = local.get(item["id"])
        if current is None or item["ts"] > current["ts"]:
            local[item["id"]] = item
            changed = True
    return changed


def occurrences_for_day(templates: dict, day: date, time_key: str | None = None) -> list[dict]:
    """Recurring items that fall on `day`, optionally filtered by time slot."""
    last_dom = (date(day.year + (day.month // 12), day.month % 12 + 1, 1) - timedelta(days=1)).day
    result = []
    for item in templates.values():
        if item["deleted"]:
            continue
        if time_key is not None and item["time"] != time_key:
            continue
        if item["repeat"] == "weekly":
            if day.weekday() != item["weekday"]:
                continue
        else:
            target = last_dom if item["day"] == -1 else min(item["day"], last_dom)
            if day.day != target:
                continue
        result.append(item)
    return sorted(result, key=lambda item: (item["time"], item["text"]))


def template_signature(templates: dict) -> str:
    return json.dumps(
        {key: templates[key] for key in sorted(templates)},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )


def merge_days(local: dict, remote: dict) -> bool:
    """Merge remote fields into local. Returns True if anything changed."""
    if not isinstance(remote, dict):
        return False
    changed = False
    for key, raw_day in remote.items():
        if not valid_day(key):
            continue
        incoming = normalize_entry(raw_day)
        current = normalize_entry(local.get(key))
        day_changed = False

        if incoming["notes"]["ts"] > current["notes"]["ts"]:
            current["notes"] = incoming["notes"]
            day_changed = True
        for time_key, field in incoming["slots"].items():
            old = current["slots"].get(time_key)
            if old is None or field["ts"] > old["ts"]:
                current["slots"][time_key] = field
                day_changed = True
        for item_id, stamp in incoming["hidden"].items():
            if current["hidden"].get(item_id, -1) < stamp:
                current["hidden"][item_id] = stamp
                day_changed = True

        if day_changed:
            local[key] = current
            changed = True
    return changed


def signature(days: dict, templates: dict | None = None) -> str:
    clean = {}
    for key in sorted(days):
        if not valid_day(key):
            continue
        entry = normalize_entry(days[key])
        clean[key] = {
            "notes": entry["notes"],
            "slots": {t: entry["slots"][t] for t in sorted(entry["slots"])},
            "hidden": {k: entry["hidden"][k] for k in sorted(entry["hidden"])},
        }
    return json.dumps(
        {"days": clean, "templates": template_signature(normalize_templates(templates))},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    )


def build_markdown(days: dict, templates: dict | None = None) -> str:
    keys = sorted(
        (k for k in days if valid_day(k) and has_content(days[k])),
        reverse=True,
    )
    lines = ["# Notes", ""]
    active = [t for t in (templates or {}).values() if not t["deleted"]]
    if active:
        lines += ["## Recurring", ""]
        for item in sorted(active, key=lambda t: (t["repeat"], t["time"], t["text"])):
            when = (
                f"{WEEKDAYS[item['weekday']]} {item['time']}"
                if item["repeat"] == "weekly"
                else f"day {item['day'] if item['day'] != -1 else 'last'} {item['time']}"
            )
            lines.append(f"- {when} — {item['text']}")
        lines.append("")
    if not keys:
        lines += ["_No notes yet._", ""]
    for key in keys:
        day = parse_day(key)
        entry = normalize_entry(days[key])
        lines += [f"## {weekday_name(day)} {long_date(day)}", ""]
        times = sorted(t for t, f in entry["slots"].items() if f["text"].strip())
        if times:
            lines += ["### Appointments", ""]
            for time_key in times:
                text = " ".join(entry["slots"][time_key]["text"].split())
                lines.append(f"- {time_key} — {text}")
            lines.append("")
        if entry["notes"]["text"].strip():
            lines += ["### Notes", "", entry["notes"]["text"].strip(), ""]
    return "\n".join(lines) + "\n"


# ---------- Files on this computer ----------

def app_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home())
    folder = Path(base) / APP_NAME
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def settings_path() -> Path:
    return app_dir() / "settings.json"


def cache_path() -> Path:
    return app_dir() / "agenda.json"


def templates_path() -> Path:
    return app_dir() / "templates.json"


def default_settings() -> dict:
    return {
        "owner": "",
        "repo": "notities",
        "branch": "main",
        "path": "notities",
        "token": "",
        "autosave": True,
        "lastSignature": "",
        "lastBackup": "",
        "ink": "blue",
    }


def load_settings() -> dict:
    cfg = default_settings()
    try:
        stored = json.loads(settings_path().read_text(encoding="utf-8"))
        if isinstance(stored, dict):
            cfg.update({k: v for k, v in stored.items() if k in cfg})
    except (OSError, ValueError):
        pass
    return cfg


def save_settings(cfg: dict) -> None:
    try:
        settings_path().write_text(
            json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError:
        pass


def load_days() -> dict:
    try:
        raw = json.loads(cache_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    result = {}
    for key, value in raw.items():
        if valid_day(key):
            entry = normalize_entry(value)
            if entry["notes"]["text"] or entry["slots"]:
                result[key] = entry
    return result


def save_days(days: dict) -> None:
    try:
        cache_path().write_text(
            json.dumps(days, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
    except OSError:
        pass


def load_templates() -> dict:
    try:
        raw = json.loads(templates_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return normalize_templates(raw)


def save_templates(templates: dict) -> None:
    try:
        templates_path().write_text(
            json.dumps(templates, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError:
        pass


# ---------- GitHub API ----------

def api_headers(token: str) -> dict:
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Notities-Windows/1.0",
    }


def contents_url(cfg: dict, filename: str) -> str:
    owner = parse.quote(str(cfg.get("owner", "")).strip(), safe="")
    repo = parse.quote(str(cfg.get("repo", "")).strip().removesuffix(".git"), safe="")
    base = f"https://api.github.com/repos/{owner}/{repo}/contents/"
    folder = str(cfg.get("path", "")).strip().strip("/")
    parts = [folder] if folder else []
    parts.extend(part for part in str(filename).split("/") if part)
    return base + "/".join(parse.quote(part, safe="") for part in parts)


def _detail(exc: error.HTTPError) -> str:
    try:
        body = json.loads(exc.read().decode("utf-8", "replace"))
        message = body.get("message") if isinstance(body, dict) else ""
        if message:
            return str(message)
    except (ValueError, AttributeError):
        pass
    return str(exc.reason)


def api_get(cfg: dict, filename: str) -> dict | None:
    """Fetch a file. Returns None on 404."""
    url = contents_url(cfg, filename) + "?ref=" + parse.quote(cfg.get("branch", "main"), safe="")
    req = request.Request(url, headers=api_headers(cfg.get("token", "")))
    try:
        with request.urlopen(req, timeout=20) as response:
            data = json.load(response)
        content = data.get("content") or ""
        text = base64.b64decode(content).decode("utf-8", "replace")
        return {"sha": data.get("sha"), "text": text}
    except error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise GitHubError(f"GitHub returned status {exc.code}: {_detail(exc)}") from exc
    except error.URLError as exc:
        raise GitHubError(f"No connection: {exc.reason}") from exc
    except (ValueError, OSError) as exc:
        raise GitHubError(f"Could not read file: {exc}") from exc


def api_put(cfg: dict, filename: str, content: str, sha: str | None) -> dict:
    payload = {
        "message": f"Notes updated — {long_date(date.today())}",
        "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
        "branch": cfg.get("branch", "main") or "main",
    }
    if sha:
        payload["sha"] = sha
    req = request.Request(
        contents_url(cfg, filename),
        data=json.dumps(payload).encode("utf-8"),
        headers={**api_headers(cfg.get("token", "")), "Content-Type": "application/json"},
        method="PUT",
    )
    try:
        with request.urlopen(req, timeout=20) as response:
            data = json.load(response)
        return {"ok": True, "sha": (data.get("content") or {}).get("sha") or sha}
    except error.HTTPError as exc:
        return {"ok": False, "status": exc.code, "message": _detail(exc)}
    except error.URLError as exc:
        return {"ok": False, "status": 0, "message": str(exc.reason)}


def test_connection(cfg: dict) -> tuple[bool, str]:
    owner = parse.quote(str(cfg.get("owner", "")).strip(), safe="")
    repo = parse.quote(str(cfg.get("repo", "")).strip().removesuffix(".git"), safe="")
    if not owner or not repo or not cfg.get("token"):
        return False, "Enter owner, repository and token."
    url = f"https://api.github.com/repos/{owner}/{repo}"
    req = request.Request(url, headers=api_headers(cfg["token"]))
    try:
        with request.urlopen(req, timeout=15) as response:
            json.load(response)
        return True, "Connection OK — repository found."
    except error.HTTPError as exc:
        return False, f"GitHub returned status {exc.code}: {_detail(exc)}"
    except error.URLError as exc:
        return False, f"No connection: {exc.reason}"
    except ValueError:
        return False, "Unexpected response from GitHub."


def _json_payload(days: dict, templates: dict | None = None) -> str:
    return json.dumps(
        {
            "schema": SCHEMA,
            "updated": datetime.now().isoformat(timespec="seconds"),
            "days": days,
            "templates": normalize_templates(templates),
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _month_key() -> str:
    return date.today().strftime("%Y-%m")


def _merge_remote(parsed: object, days: dict, templates: dict) -> bool:
    if not isinstance(parsed, dict):
        return False
    changed = False
    if parsed.get("schema") == SCHEMA or "days" in parsed:
        if isinstance(parsed.get("days"), dict):
            changed = merge_days(days, parsed["days"]) or changed
        if isinstance(parsed.get("templates"), dict):
            changed = merge_templates(templates, parsed["templates"]) or changed
    return changed


def sync_once(cfg: dict, days: dict, templates: dict | None = None,
              force: bool = False) -> dict:
    """Pull, merge and push both days and recurring items in place."""
    if templates is None:
        templates = {}
    remote = api_get(cfg, "agenda.json")
    changed = False
    if remote:
        try:
            changed = _merge_remote(json.loads(remote["text"]), days, templates)
        except (ValueError, TypeError):
            pass  # unreadable file: keep local data

    save_days(days)
    save_templates(templates)
    current_signature = signature(days, templates)
    if not force and cfg.get("lastSignature") == current_signature and remote is not None:
        return {"changed": changed, "status": "all_synced"}

    files = (
        ("agenda.json", _json_payload(days, templates)),
        ("agenda.md", build_markdown(days, templates)),
    )
    for filename, content in files:
        result = None
        for _attempt in range(2):
            current = api_get(cfg, filename)
            result = api_put(cfg, filename, content, current["sha"] if current else None)
            if result["ok"] or result.get("status") != 409:
                break
            # Someone just changed the file: fetch again and merge.
            again = api_get(cfg, filename)
            if again and filename == "agenda.json":
                try:
                    if _merge_remote(json.loads(again["text"]), days, templates):
                        changed = True
                    content = _json_payload(days, templates)
                except (ValueError, TypeError):
                    pass
        if not result["ok"]:
            detail = result.get("message") or f"status {result.get('status')}"
            raise GitHubError(f"{filename} could not be saved: {detail}")

    # One read-only snapshot per month, so old months stay recoverable.
    month = _month_key()
    if cfg.get("lastBackup") != month:
        backup_name = f"backups/{month}.json"
        try:
            if api_get(cfg, backup_name) is None:
                api_put(cfg, backup_name, _json_payload(days, templates), None)
            cfg["lastBackup"] = month
        except GitHubError:
            pass  # backups are best-effort; normal sync must still succeed

    cfg["lastSignature"] = signature(days, templates)
    save_settings(cfg)
    save_days(days)
    save_templates(templates)
    return {"changed": changed, "status": "synced"}
