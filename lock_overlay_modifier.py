import re
from pathlib import Path
from typing import List, Union

def process_lock_overlays(files: List[Union[str, Path]]) -> int:
    """
    Processes HTML files to update lock overlay styling.
    Returns the number of files updated.
    """
    overlay_pattern = re.compile(r'(class="absolute inset-0 z-10 flex flex-col items-center) justify-center (.*?")')
    inner_div_pattern = re.compile(r'(<div class="relative z-20 max-w-sm mx-auto space-y-4 animate-fade-in-up">)')

    updated_count = 0

    for file_path in files:
        path_obj = Path(file_path)
        if not path_obj.exists() or not path_obj.is_file():
            print(f"Skipping {file_path} (not found)")
            continue

        content = path_obj.read_text(encoding='utf-8')

        # 1. Remove justify-center from the overlay container
        new_content = overlay_pattern.sub(r'\1 \2', content)

        # 2. Add sticky top-[30vh] to the inner relative div
        new_content = inner_div_pattern.sub(r'<div class="sticky top-[30vh] relative z-20 max-w-sm mx-auto space-y-4 animate-fade-in-up">', new_content)

        if new_content != content:
            path_obj.write_text(new_content, encoding='utf-8')
            print(f"Updated {file_path}")
            updated_count += 1
        else:
            print(f"No changes for {file_path}")

    return updated_count
