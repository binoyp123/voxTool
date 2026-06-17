"""Build threshold-cloud JSON cache (run as a detached subprocess on Render)."""
import os
import sys
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from app import create_app  # noqa: E402
from routes.scans import _cloud_cache_path, _write_threshold_cloud_cache  # noqa: E402


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: warm_cloud.py <nifti_path> <threshold_pct>", file=sys.stderr)
        return 1

    filepath = sys.argv[1]
    threshold_pct = float(sys.argv[2])
    if not os.path.isfile(filepath):
        print(f"missing file: {filepath}", file=sys.stderr)
        return 1

    cache_path = _cloud_cache_path(filepath, threshold_pct)
    lock_path = cache_path + ".building"
    if os.path.isfile(cache_path):
        return 0

    if os.path.isfile(lock_path):
        age = time.time() - os.path.getmtime(lock_path)
        if age < 900:
            return 0
        os.remove(lock_path)

    try:
        with open(lock_path, "x", encoding="utf-8"):
            pass
    except FileExistsError:
        return 0

    app = create_app()
    try:
        with app.app_context():
            _write_threshold_cloud_cache(filepath, threshold_pct)
    finally:
        try:
            os.remove(lock_path)
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
