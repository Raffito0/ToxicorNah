# Bulk Upload Guide: Add Hundreds of Illustrations Fast

## Quick Start

1. **Create your JSON file** with all your images
2. **Run one command** to upload everything
3. **Done!** All images are in the database

---

## Step 1: Prepare Your Data

Create a JSON file (e.g., `my-images.json`) with this format:

```json
[
  {
    "url": "https://example.com/image1.jpg",
    "tags": ["happy", "energetic", "warm"],
    "category": "EMOTIONAL TONE",
    "style": "portrait"
  },
  {
    "url": "/public/image2.png",
    "tags": ["deep", "thoughtful"],
    "category": "POWER BALANCE",
    "style": "abstract"
  }
]
```

### Field Descriptions:

- **url** (required): Image URL or path
  - External: `https://yoursite.com/image.jpg`
  - Local: `/public/image.png`

- **tags** (required): Array of keywords for matching
  - Examples: `["happy", "warm"]`, `["deep", "calm"]`

- **category** (optional): Which card type
  - Options: `EMOTIONAL TONE`, `POWER BALANCE`, `TRUST & VULNERABILITY`, `COMPATIBILITY FLOW`, `FUTURE VIBE`
  - Leave empty if you want to map manually later

- **style** (optional): Art style
  - Examples: `portrait`, `abstract`, `nature`, `illustration`

---

## Step 2: Upload Everything

Run this command:

```bash
npm run upload-illustrations my-images.json
```

**That's it!** All images upload in seconds.

---

## Example: Upload 100 Images

Create `100-images.json`:

```json
[
  {
    "url": "https://mycdn.com/img1.jpg",
    "tags": ["happy", "bright"],
    "category": "EMOTIONAL TONE"
  },
  {
    "url": "https://mycdn.com/img2.jpg",
    "tags": ["calm", "peaceful"],
    "category": "POWER BALANCE"
  },
  ... (98 more entries)
]
```

Upload:
```bash
npm run upload-illustrations 100-images.json
```

Done! All 100 images are now in your database.

---

## Tips for Hundreds of Images

### 1. Generate JSON from a Spreadsheet

If you have images in Excel/Google Sheets:
1. Export as CSV
2. Use a converter tool (search "CSV to JSON converter")
3. Adjust the format to match the template
4. Upload

### 2. Use a Script to Generate JSON

If images are in a folder, you can create a simple script:

```javascript
const fs = require('fs');
const images = fs.readdirSync('./my-images');

const json = images.map(filename => ({
  url: `/public/${filename}`,
  tags: ["tag1", "tag2"],
  category: "EMOTIONAL TONE"
}));

fs.writeFileSync('images.json', JSON.stringify(json, null, 2));
```

### 3. Add in Batches

If you have 1000 images, upload in batches:
- `images-1-500.json`
- `images-501-1000.json`

More manageable if errors occur.

---

## Template File

There's a template file included: `illustrations-template.json`

Copy it, fill in your data, and upload:

```bash
cp illustrations-template.json my-images.json
# Edit my-images.json with your data
npm run upload-illustrations my-images.json
```

---

## What You'll See

When you run the upload, you'll see:

```
📦 Found 150 illustrations to upload
✅ Successfully uploaded 150 illustrations!

📊 Summary:
   EMOTIONAL TONE: 30 images
   POWER BALANCE: 40 images
   TRUST & VULNERABILITY: 35 images
   COMPATIBILITY FLOW: 25 images
   FUTURE VIBE: 20 images
```

---

## Troubleshooting

**Error: "Cannot find file"**
- Make sure the JSON file path is correct
- Use `./` for current folder: `npm run upload-illustrations ./my-images.json`

**Error: "Invalid JSON"**
- Check your JSON syntax at https://jsonlint.com
- Make sure all quotes are double quotes `"`
- Arrays need square brackets `[]`

**Some images not showing**
- Make sure `url` fields are valid
- Check that `category` matches one of the 5 options
- Verify image URLs are accessible

---

## Summary

**Fastest way to add hundreds of images:**
1. Create JSON file with all image data
2. Run: `npm run upload-illustrations your-file.json`
3. All images upload instantly

No clicking. No manual entry. Just one command.
