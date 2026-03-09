import os, sys
sys.stdout.reconfigure(encoding='utf-8')

def clean_non_ascii(content):
    # Box drawing chars -> ASCII
    box = {}
    for c in range(0x2500, 0x257F):
        box[chr(c)] = '-' if c < 0x2502 else '|' if c < 0x250C else '+'
    for c in range(0x2550, 0x256D):
        box[chr(c)] = '=' if c == 0x2550 else '|' if c == 0x2551 else '+'
    box['\u2588'] = '#'
    box['\u2591'] = '.'
    box['\u2592'] = '#'
    box['\u2593'] = '#'
    box['\u2580'] = '#'
    box['\u2584'] = '#'
    box['\u2022'] = '*'
    box['\u00b7'] = '*'

    for ch, repl in box.items():
        content = content.replace(ch, repl)

    # Stray \u00e2 \u00e3 from mojibake
    content = content.replace('\u00e2', '')
    content = content.replace('\u00e3', '')

    # Remaining Unicode symbols
    content = content.replace('\u20ac', '')  # Euro sign (mojibake artifact)
    content = content.replace('\u2020', '')  # dagger (mojibake artifact)
    content = content.replace('\u2021', '')  # double dagger
    content = content.replace('\u0152', '')  # OE ligature (mojibake)
    content = content.replace('\u0153', '')  # oe ligature (mojibake)
    content = content.replace('\u02dc', '')  # small tilde (mojibake)
    content = content.replace('\u0178', '')  # Y diaeresis (mojibake)

    return content

total_files = 0
for fname in sorted(os.listdir('n8n/code')):
    if not fname.endswith('.js'):
        continue
    path = os.path.join('n8n/code', fname)
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    fixed = clean_non_ascii(content)
    if fixed != content:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(fixed)
        remaining = sum(1 for ch in fixed if ord(ch) > 127)
        print(f'Fixed {fname} (remaining non-ASCII: {remaining})')
        total_files += 1

print(f'Total files cleaned: {total_files}')

# Verify no non-ASCII left
print('\n--- Verification ---')
for fname in sorted(os.listdir('n8n/code')):
    if not fname.endswith('.js'):
        continue
    path = os.path.join('n8n/code', fname)
    with open(path, 'r', encoding='utf-8') as f:
        for lineno, line in enumerate(f, 1):
            for i, ch in enumerate(line):
                if ord(ch) > 127:
                    print(f'  {fname}:{lineno} U+{ord(ch):04X} {repr(ch)}')
