import os
import shutil

src_dir = "chrome-enx"
dst_dir = os.path.join(src_dir, "public")

file_count = 0
byte_count = 0

# Clear the public directory before copying
if os.path.exists(dst_dir):
    shutil.rmtree(dst_dir)
os.makedirs(dst_dir)

for root, dirs, files in os.walk(src_dir):
    # Skip the public directory
    if dst_dir in root:
        continue

    for file in files:
        src_file = os.path.join(root, file)
        # Calculate the target file path
        rel_path = os.path.relpath(src_file, src_dir)
        dst_file = os.path.join(dst_dir, rel_path)
        dst_file_dir = os.path.dirname(dst_file)
        if not os.path.exists(dst_file_dir):
            os.makedirs(dst_file_dir)
        try:
            # Try to open as text file
            with open(src_file, "r", encoding="utf-8") as f:
                content = f.read()
            content = content.replace("enx.wiloon.com", "enx-dev.wiloon.com")
            with open(dst_file, "w", encoding="utf-8") as f:
                f.write(content)
            file_size = os.path.getsize(dst_file)
        except UnicodeDecodeError:
            # If not a text file, copy as binary
            shutil.copy2(src_file, dst_file)
            file_size = os.path.getsize(dst_file)
        file_count += 1
        byte_count += file_size

print(f"Copied {file_count} files, total {byte_count} bytes.")