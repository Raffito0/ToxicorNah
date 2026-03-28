"""
Figma JSON → React + Tailwind converter
Reads figma-data.json and generates pixel-perfect React components
with exact Tailwind arbitrary values (w-[384px], text-[#1C1B1B], etc.)
"""

import json
import sys
import re
from pathlib import Path

def hex_color(c):
    """Convert Figma color object {r,g,b,a} to hex string"""
    r, g, b = int(c['r']*255), int(c['g']*255), int(c['b']*255)
    return f"#{r:02x}{g:02x}{b:02x}"

def get_fill(node):
    """Extract background color/gradient from fills"""
    for f in node.get('fills', []):
        if not f.get('visible', True): continue
        if f['type'] == 'SOLID':
            a = f.get('opacity', f.get('color', {}).get('a', 1.0))
            color = hex_color(f['color'])
            if a < 1.0:
                return f"bg-[{color}]", f"opacity-[{a:.2f}]"
            return f"bg-[{color}]", None
        elif f['type'] == 'GRADIENT_LINEAR':
            stops = f.get('gradientStops', [])
            if len(stops) >= 2:
                c1 = hex_color(stops[0]['color'])
                c2 = hex_color(stops[-1]['color'])
                return f"bg-gradient-to-b from-[{c1}] to-[{c2}]", None
    return None, None

def get_text_color(node):
    """Extract text color from fills"""
    for f in node.get('fills', []):
        if not f.get('visible', True): continue
        if f['type'] == 'SOLID':
            return f"text-[{hex_color(f['color'])}]"
    return ""

def get_typography(node):
    """Extract font classes from style object"""
    st = node.get('style', {})
    if not st.get('fontFamily'):
        return []

    classes = []

    # Font family
    family = st['fontFamily']
    if 'Montaga' in family or 'Montagu' in family:
        classes.append("font-[var(--font-montaga)]")
    elif 'Space Mono' in family or 'Carmen' in family:
        classes.append("font-[var(--font-mono)]")
    # Inter is default, no class needed

    # Font size
    size = st.get('fontSize')
    if size:
        classes.append(f"text-[{int(size)}px]")

    # Font weight
    weight = st.get('fontWeight', 400)
    weight_map = {100:'font-thin',200:'font-extralight',300:'font-light',
                  400:'font-normal',500:'font-medium',600:'font-semibold',
                  700:'font-bold',800:'font-extrabold',900:'font-black'}
    if weight in weight_map:
        classes.append(weight_map[weight])
    else:
        classes.append(f"font-[{int(weight)}]")

    # Line height
    lh = st.get('lineHeightPx')
    if lh and size and abs(lh - size * 1.5) > 2:
        classes.append(f"leading-[{int(lh)}px]")

    # Letter spacing
    ls = st.get('letterSpacing', 0)
    if ls and abs(ls) > 0.05:
        classes.append(f"tracking-[{ls:.1f}px]")

    return classes

def get_layout(node):
    """Extract flexbox layout classes"""
    classes = []
    lm = node.get('layoutMode')

    if lm == 'VERTICAL':
        classes.append("flex flex-col")
    elif lm == 'HORIZONTAL':
        classes.append("flex flex-row")

    # Gap
    gap = node.get('itemSpacing')
    if gap and gap > 0:
        classes.append(f"gap-[{int(gap)}px]")

    # Padding
    pt = int(node.get('paddingTop', 0))
    pr = int(node.get('paddingRight', 0))
    pb = int(node.get('paddingBottom', 0))
    pl = int(node.get('paddingLeft', 0))

    if pt == pb and pl == pr and pt == pl and pt > 0:
        classes.append(f"p-[{pt}px]")
    else:
        if pt > 0: classes.append(f"pt-[{pt}px]")
        if pr > 0: classes.append(f"pr-[{pr}px]")
        if pb > 0: classes.append(f"pb-[{pb}px]")
        if pl > 0: classes.append(f"pl-[{pl}px]")

    # Alignment
    pa = node.get('primaryAxisAlignItems', '')
    ca = node.get('counterAxisAlignItems', '')

    align_map = {'MIN':'start','CENTER':'center','MAX':'end','SPACE_BETWEEN':'between'}
    if pa and pa in align_map:
        classes.append(f"justify-{align_map[pa]}")
    if ca and ca in align_map:
        classes.append(f"items-{align_map[ca]}")

    return classes

def get_dimensions(node):
    """Extract width/height"""
    bb = node.get('absoluteBoundingBox', {})
    w = int(bb.get('width', 0))
    h = int(bb.get('height', 0))
    return w, h

def get_border(node):
    """Extract border classes"""
    classes = []
    for s in node.get('strokes', []):
        if not s.get('visible', True): continue
        if s['type'] == 'SOLID':
            sw = int(node.get('strokeWeight', 1))
            color = hex_color(s['color'])
            if sw == 1:
                classes.append(f"border border-[{color}]")
            else:
                classes.append(f"border-[{sw}px] border-[{color}]")
    return classes

def get_effects(node):
    """Extract shadow/blur classes"""
    classes = []
    for e in node.get('effects', []):
        if not e.get('visible', True): continue
        if e['type'] == 'DROP_SHADOW':
            o = e.get('offset', {})
            x, y = int(o.get('x', 0)), int(o.get('y', 0))
            r = int(e.get('radius', 0))
            c = e.get('color', {})
            a = c.get('a', 0.25)
            classes.append(f"shadow-[{x}px_{y}px_{r}px_rgba(0,0,0,{a:.2f})]")
    return classes

def get_corner_radius(node):
    """Extract border radius"""
    cr = node.get('cornerRadius')
    if cr and cr > 0:
        return [f"rounded-[{int(cr)}px]"]
    return []

def node_to_tailwind(node, depth=0, max_depth=8, parent_w=1280):
    """Convert a Figma node to React JSX with Tailwind classes"""
    if depth > max_depth:
        return ""

    name = node.get('name', '')
    ntype = node.get('type', '')
    w, h = get_dimensions(node)
    children = node.get('children', [])
    chars = node.get('characters', '')

    indent = "  " * (depth + 1)

    # Skip invisible nodes
    if node.get('visible') == False:
        return ""

    # --- TEXT nodes ---
    if ntype == 'TEXT':
        classes = []
        text_color = get_text_color(node)
        if text_color:
            classes.append(text_color)
        classes.extend(get_typography(node))

        op = node.get('opacity', 1.0)
        if op < 1.0:
            classes.append(f"opacity-[{op:.2f}]")

        class_str = " ".join(classes)

        # Escape text for JSX
        text = chars.replace('{', '&#123;').replace('}', '&#125;')
        text = text.replace('"', '&quot;').replace("'", "&apos;")

        # Multi-line text
        if '\n' in text:
            lines = text.split('\n')
            inner = f"<br />".join(lines)
            return f'{indent}<p className="{class_str}">{inner}</p>\n'

        return f'{indent}<p className="{class_str}">{text}</p>\n'

    # --- VECTOR/IMAGE nodes ---
    if ntype in ('VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'REGULAR_POLYGON'):
        if w > 0 and h > 0:
            return f'{indent}<div className="w-[{w}px] h-[{h}px]" />\n'
        return ""

    # --- RECTANGLE nodes ---
    if ntype == 'RECTANGLE':
        classes = [f"w-[{w}px]", f"h-[{h}px]"]
        bg, op_cls = get_fill(node)
        if bg: classes.append(bg)
        if op_cls: classes.append(op_cls)
        classes.extend(get_corner_radius(node))
        classes.extend(get_border(node))
        classes.extend(get_effects(node))

        op = node.get('opacity', 1.0)
        if op < 1.0:
            classes.append(f"opacity-[{op:.2f}]")

        class_str = " ".join(classes)
        return f'{indent}<div className="{class_str}" />\n'

    # --- FRAME / COMPONENT / INSTANCE / GROUP ---
    if ntype in ('FRAME', 'COMPONENT', 'INSTANCE', 'GROUP', 'SECTION'):
        classes = []

        # Layout
        layout_classes = get_layout(node)
        classes.extend(layout_classes)

        # If this is a GRID layout
        if node.get('layoutMode') == 'GRID' or (not node.get('layoutMode') and len(children) > 1):
            # Check if children form a grid pattern
            pass

        # Background
        bg, op_cls = get_fill(node)
        if bg: classes.append(bg)
        if op_cls: classes.append(op_cls)

        # Border
        classes.extend(get_border(node))

        # Corner radius
        classes.extend(get_corner_radius(node))

        # Effects
        classes.extend(get_effects(node))

        # Opacity
        op = node.get('opacity', 1.0)
        if op < 1.0:
            classes.append(f"opacity-[{op:.2f}]")

        # Sizing constraints
        cs = node.get('counterAxisSizingMode', '')
        ps = node.get('primaryAxisSizingMode', '')

        # For top-level sections, use max-w and mx-auto pattern
        if depth <= 1 and w == 1280:
            classes.append("w-full")
        elif depth == 2 and w < 1280 and w > 200:
            classes.append(f"max-w-[{w}px]")
            if not any('mx-' in c for c in classes):
                classes.append("mx-auto")

        class_str = " ".join(classes)

        # Generate children
        child_jsx = ""
        for child in children:
            child_jsx += node_to_tailwind(child, depth + 1, max_depth, w)

        if not child_jsx.strip():
            if w > 0 and h > 0 and not classes:
                return f'{indent}<div className="w-[{w}px] h-[{h}px]" />\n'
            elif classes:
                return f'{indent}<div className="{class_str}" />\n'
            return ""

        # Add comment with section name for readability
        comment = ""
        if depth <= 2 and name and 'Section' in name:
            safe_name = name.replace('--', '- -')
            comment = f'{indent}{{/* {safe_name} */}}\n'

        return f'{comment}{indent}<div className="{class_str}">\n{child_jsx}{indent}</div>\n'

    return ""


def convert_frame_to_component(frame_node, component_name):
    """Convert a top-level Figma frame to a React component"""
    jsx_body = ""
    for child in frame_node.get('children', []):
        jsx_body += node_to_tailwind(child, depth=1, max_depth=7)

    # Get frame background
    bg, _ = get_fill(frame_node)
    bg_class = bg or "bg-white"

    component = f'''export default function {component_name}() {{
  return (
    <div className="{bg_class}">
{jsx_body}    </div>
  );
}}
'''
    return component


def main():
    if len(sys.argv) < 2:
        print("Usage: python figma-to-react.py <frame_name> [output_file]")
        print("Available frames:")

        figma_path = Path(__file__).parent.parent / "figma-data.json"
        with open(figma_path) as f:
            data = json.load(f)

        for page in data['document']['children']:
            for frame in page.get('children', []):
                bb = frame.get('absoluteBoundingBox', {})
                w, h = int(bb.get('width', 0)), int(bb.get('height', 0))
                print(f"  - {frame['name']} ({w}x{h})")
        return

    frame_name = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    figma_path = Path(__file__).parent.parent / "figma-data.json"
    with open(figma_path) as f:
        data = json.load(f)

    # Find the frame
    target = None
    for page in data['document']['children']:
        for frame in page.get('children', []):
            if frame['name'] == frame_name:
                target = frame
                break

    if not target:
        print(f"Frame '{frame_name}' not found!")
        return

    # Convert name to component name
    comp_name = re.sub(r'[^a-zA-Z0-9]', '', frame_name.title().replace(' ', ''))
    comp_name = comp_name + "Page"

    result = convert_frame_to_component(target, comp_name)

    if output_file:
        Path(output_file).parent.mkdir(parents=True, exist_ok=True)
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(result)
        print(f"Written to {output_file}")
    else:
        print(result)


if __name__ == "__main__":
    main()
