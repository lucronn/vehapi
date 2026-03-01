import re
from pathlib import Path

import argparse

# Base directory
base_dir = Path(__file__).resolve().parent / "src" / "pages" / "vehicle-dashboard" / "components" / "sections"

def get_files(target_files=None):
    if target_files:
        files = []
        for file_path in target_files:
            p = Path(file_path)
            if p.is_absolute():
                files.append(p)
            else:
                files.append(Path(__file__).resolve().parent / p)
        return files
    return list(base_dir.rglob("*.component.html"))

overlay_pattern = re.compile(r'(class="absolute inset-0 z-10 flex flex-col items-center) justify-center (.*?")')
inner_div_pattern = re.compile(r'(<div class="relative z-20 max-w-sm mx-auto space-y-4 animate-fade-in-up">)')

def process_files(files):
    updated_count = 0

    for file_path in files:
        if not file_path.exists():
            print(f"Skipping {file_path}: File not found")
            continue

        content = file_path.read_text(encoding='utf-8')

        # 1. Remove justify-center from the overlay container
        new_content = overlay_pattern.sub(r'\1 \2', content)

        # 2. Add sticky top-[30vh] to the inner relative div
        new_content = inner_div_pattern.sub(r'<div class="sticky top-[30vh] relative z-20 max-w-sm mx-auto space-y-4 animate-fade-in-up">', new_content)

        if new_content != content:
            file_path.write_text(new_content, encoding='utf-8')
            print(f"Updated {file_path}")
            updated_count += 1
        else:
            print(f"No changes for {file_path}")

    print(f"Total files updated: {updated_count}")

def main():
    parser = argparse.ArgumentParser(description="Fix locks overlays in component HTML files.")
    parser.add_argument("files", nargs="*", help="Optional specific file paths to process. If empty, process all component HTML files in sections.")
    args = parser.parse_args()
    
    files = get_files(args.files)
    process_files(files)

if __name__ == "__main__":
    main()
