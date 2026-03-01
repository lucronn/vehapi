import os
from pathlib import Path
from lock_overlay_modifier import process_lock_overlays

base_dir = Path(__file__).resolve().parent / "src" / "pages" / "vehicle-dashboard" / "components" / "sections"

files = [
    base_dir / "tsb-section" / "tsb-section.component.html",
    base_dir / "procedures-section" / "procedures-section.component.html",
    base_dir / "parts-section" / "parts-section.component.html",
    base_dir / "maintenance-section" / "maintenance-section.component.html",
    base_dir / "dtc-section" / "dtc-section.component.html",
    base_dir / "component-locations-section" / "component-locations-section.component.html",
    base_dir / "diagrams-section" / "diagrams-section.component.html",
    base_dir / "common-issues-section" / "common-issues-section.component.html"
]

updated_count = process_lock_overlays(files)
