import os
import re

files = [
    r"x:\cursor\vehapi\src\pages\vehicle-dashboard\components\sections\tsb-section\tsb-section.component.html",
    r"x:\cursor\vehapi\src\pages\vehicle-dashboard\components\sections\procedures-section\procedures-section.component.html",
    r"x:\cursor\vehapi\src\pages\vehicle-dashboard\components\sections\parts-section\parts-section.component.html",
    r"x:\cursor\vehapi\src\pages\vehicle-dashboard\components\sections\maintenance-section\maintenance-section.component.html",
    r"x:\cursor\vehapi\src\pages\vehicle-dashboard\components\sections\dtc-section\dtc-section.component.html",
    r"x:\cursor\vehapi\src\pages\vehicle-dashboard\components\sections\component-locations-section\component-locations-section.component.html",
    r"x:\cursor\vehapi\src\pages\vehicle-dashboard\components\sections\diagrams-section\diagrams-section.component.html",
    r"x:\cursor\vehapi\src\pages\vehicle-dashboard\components\sections\common-issues-section\common-issues-section.component.html"
]

for file_path in files:
    if not os.path.exists(file_path):
        print(f"Skipping {file_path}")
        continue
        
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 1. Remove justify-center from the overlay
    new_content = re.sub(
        r'class="absolute inset-0 z-10 flex flex-col items-center justify-center (.*?)">',
        r'class="absolute inset-0 z-10 flex flex-col items-center \1">',
        content
    )
    
    # 2. Add sticky top-[30vh] to the inner relative div
    new_content = re.sub(
        r'<div class="relative z-20 max-w-sm mx-auto space-y-4 animate-fade-in-up">',
        r'<div class="sticky top-[30vh] relative z-20 max-w-sm mx-auto space-y-4 animate-fade-in-up">',
        new_content
    )
    
    if new_content != content:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated {file_path}")
    else:
        print(f"No changes for {file_path}")
