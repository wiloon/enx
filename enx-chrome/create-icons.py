#!/usr/bin/env python3
from PIL import Image, ImageDraw
import os

def create_icon(size):
    # Create image with gradient-like purple background
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Draw rounded rectangle background (purple)
    radius = max(3, size // 5)
    draw.rounded_rectangle([(0, 0), (size-1, size-1)], radius=radius, fill='#667eea')
    
    # Calculate proportions
    line_width = max(1, size // 10)
    margin = size // 4
    spacing = size // 4
    
    # Draw three horizontal lines (white) representing text
    y_positions = [
        margin,
        size // 2 - line_width // 2,
        size - margin
    ]
    
    line_lengths = [
        size - 2 * margin,
        int((size - 2 * margin) * 0.75),
        size - 2 * margin
    ]
    
    for i, y in enumerate(y_positions):
        draw.rounded_rectangle(
            [(margin, y), (margin + line_lengths[i], y + line_width)],
            radius=line_width // 2,
            fill='white'
        )
    
    # Draw gold star (achievement symbol)
    star_size = max(3, size // 8)
    star_x = size - margin // 2
    star_y = margin // 2
    draw.ellipse(
        [(star_x - star_size, star_y - star_size), 
         (star_x + star_size, star_y + star_size)],
        fill='#ffd700'
    )
    
    return img

# Create icons directory if it doesn't exist
os.makedirs('icons', exist_ok=True)

# Generate all sizes
sizes = [16, 32, 48, 128]
for size in sizes:
    icon = create_icon(size)
    icon.save(f'icons/icon-{size}.png', 'PNG')
    print(f'Created icon-{size}.png')

print('All icons created successfully!')
