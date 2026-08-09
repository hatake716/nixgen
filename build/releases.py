"""Which NixOS releases exist, and building an index for one of them.

NixOS ships two numbered releases a year, YY.05 and YY.11. Rather than hard-code
a list that goes stale, the candidates around the present are probed once and
the ones that actually publish option data are kept.

Each release gets its own database file, so switching back to one you have
already built is instant.
"""

import concurrent.futures
import datetime
import os
import re
import shutil
import subprocess
import sys
import threading
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

CHANNEL_RE = re.compile(r"^nixos-(\d\d)\.(05|11)$")
KEEP = 3          # the current release and the two before it
PROBE_TIMEOUT = 12

_cache = {"channels": None, "at": None}
_lock = threading.Lock()

# Progress of a build in flight, read by /api/reindex/status.
status = {"state": "idle", "channel": None, "message": ""}


# ------------------------------------------------------------------ discovery

def _candidates(today=None):
    """Every release number that could plausibly exist, newest first."""
    today = today or datetime.date.today()
    year = today.year % 100
    out = []
    for y in range(year + 1, year - 4, -1):
        for m in ("11", "05"):
            out.append(f"nixos-{y:02d}.{m}")
    return out


def _published(channel):
    url = f"https://channels.nixos.org/{channel}/options.json.br"
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=PROBE_TIMEOUT) as r:
            return channel, r.status == 200
    except Exception:
        return channel, False


def releases(refresh=False):
    """The newest KEEP releases that publish option data, newest first."""
    with _lock:
        if _cache["channels"] and not refresh:
            return _cache["channels"]
    found = []
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        for channel, ok in pool.map(_published, _candidates()):
            if ok:
                found.append(channel)
    found.sort(reverse=True)
    keep = found[:KEEP]
    with _lock:
        _cache["channels"] = keep
        _cache["at"] = datetime.datetime.now().isoformat(timespec="seconds")
    return keep


def is_release(channel):
    return bool(CHANNEL_RE.match(channel or ""))


# -------------------------------------------------------------------- indexes

def db_for(data_dir, channel):
    return os.path.join(data_dir, f"nixgen-{channel}.sqlite")


def build(data_dir, channel, on_done=None):
    """Fetch and index one release into its own database file.

    Runs in a scratch directory so the database currently being served is never
    touched, even if the build fails half way.
    """
    def run():
        scratch = os.path.join(data_dir, f".build-{channel}")
        shutil.rmtree(scratch, ignore_errors=True)
        os.makedirs(scratch, exist_ok=True)
        try:
            status.update(state="fetching", channel=channel,
                          message=f"Downloading {channel} metadata (about 10 MB)…")
            env = dict(os.environ, NIXGEN_DATA=scratch)
            proc = subprocess.run(
                ["bash", os.path.join(HERE, "fetch-data.sh"), channel],
                env=env, capture_output=True, text=True, timeout=1800)
            if proc.returncode != 0:
                raise RuntimeError((proc.stderr or "download failed").strip()[:400])

            status.update(state="indexing",
                          message=f"Building the {channel} index (a few minutes)…")
            proc = subprocess.run(
                [sys.executable, os.path.join(HERE, "build_index.py"),
                 "--data", scratch, "--channel", channel],
                capture_output=True, text=True, timeout=3600)
            if proc.returncode != 0:
                raise RuntimeError((proc.stderr or "indexing failed").strip()[:400])

            target = db_for(data_dir, channel)
            os.replace(os.path.join(scratch, "nixgen.sqlite"), target)
            status.update(state="done", message=f"{channel} is ready.")
            if on_done:
                on_done(channel, target)
        except Exception as exc:                     # noqa: BLE001
            status.update(state="failed", message=str(exc)[:400])
        finally:
            shutil.rmtree(scratch, ignore_errors=True)

    status.update(state="starting", channel=channel, message="Starting…")
    threading.Thread(target=run, daemon=True).start()
