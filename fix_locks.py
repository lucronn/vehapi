from pathlib import Path
from lock_overlay_modifier import process_lock_overlays

# Base directory
base_dir = Path(__file__).resolve().parent / "src" / "pages" / "vehicle-dashboard" / "components" / "sections"

files = list(base_dir.rglob("*.component.html"))

updated_count = process_lock_overlays(files)
print(f"Total files updated: {updated_count}")
