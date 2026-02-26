import re
from pathlib import Path

# Base directory
base_dir = Path(r"x:\cursor\vehapi\src\pages\vehicle-dashboard\components\sections")

files = list(base_dir.rglob("*.component.html"))

overlay_pattern = re.compile(r'(class="absolute inset-0 z-10 flex flex-col items-center) justify-center (.*?")')
inner_div_pattern = re.compile(r'(<div class="relative z-20 max-w-sm mx-auto space-y-4 animate-fade-in-up">)')

updated_count = 0

for file_path in files:
    content = file_path.read_text(encoding='utf-8')
    
    # 1. Remove justify-center from the overlay container
    new_content = overlay_pattern.sub(r'\1 \2', content)
    
    # 2. Add sticky top-[30vh] to the inner relative div
    new_content = inner_div_pattern.sub(r'<div class="sticky top-[30vh] relative z-20 max-w-sm mx-auto space-y-4 animate-fade-in-up">', new_content)
    
    if new_content != content:
        file_path.write_text(new_content, encoding='utf-8')
        print(f"Updated {file_path}")
        updated_count += 1

print(f"Total files updated: {updated_count}")
