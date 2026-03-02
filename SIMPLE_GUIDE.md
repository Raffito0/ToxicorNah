# Simple Guide: How to Add Illustrations to Your Cards

## What This System Does

Your app shows cards with images. Before, these images were stuck in the code. Now they're in a database, so you can easily add hundreds of images without coding.

---

## 🎯 EASIEST WAY: Using Supabase Dashboard

### Step 1: Open Supabase
Go to: **https://qlhnzfmbnhzmoxhincys.supabase.co**

### Step 2: Go to Table Editor
Click **"Table Editor"** in the left sidebar

### Step 3: Open the "illustrations" table
Find and click the **"illustrations"** table

### Step 4: Add a new image
Click the **"+ Insert row"** button at the top

### Step 5: Fill in the form:

| Field | What to Put | Example |
|-------|------------|---------|
| **url** | Your image path or URL | `https://myimages.com/happy-person.jpg` or `/images/photo1.png` |
| **tags** | Words that describe the image (click "Edit as JSON") | `["happy", "warm", "energetic"]` |
| **category** | Which card type it's for | `EMOTIONAL TONE` (see options below) |
| **style** | Optional - art style | `portrait`, `abstract`, `nature` |

**Category options (pick one):**
- `EMOTIONAL TONE`
- `POWER BALANCE`
- `TRUST & VULNERABILITY`
- `COMPATIBILITY FLOW`
- `FUTURE VIBE`

### Step 6: Save
Click **"Save"** button

### Step 7: See it work
Refresh your app - the image will automatically show on cards with that category!

---

## 📊 How Images are Matched to Cards

The system is smart. It picks the best image for each card by:

1. **Category matching**: If you add an image with category `EMOTIONAL TONE`, it shows on `EMOTIONAL TONE` cards
2. **Tags**: Images with more matching tags appear first
3. **Priority**: You can set which images show first (advanced)

---

## 💡 Real Example

Let's say you want to add an image for "The Joy Bringer" card:

1. Go to Supabase dashboard
2. Open "illustrations" table
3. Click "+ Insert row"
4. Fill in:
   - url: `https://coolsite.com/happy-person.jpg`
   - tags: `["joyful", "warm", "positive"]`
   - category: `TRUST & VULNERABILITY`
   - style: `portrait`
5. Save

Done! The Joy Bringer card will now show this image.

---

## 🚀 Adding Many Images at Once

If you have 100 images, you don't want to click 100 times. Here's how to bulk add:

### Go to SQL Editor in Supabase:
1. Click **"SQL Editor"** in left sidebar
2. Click **"New query"**
3. Paste this (change the URLs and tags to yours):

```sql
INSERT INTO illustrations (url, tags, category, style)
VALUES
  ('/images/happy1.jpg', ARRAY['happy', 'warm'], 'EMOTIONAL TONE', 'portrait'),
  ('/images/happy2.jpg', ARRAY['joyful', 'bright'], 'EMOTIONAL TONE', 'abstract'),
  ('/images/deep1.jpg', ARRAY['thoughtful', 'deep'], 'POWER BALANCE', 'portrait'),
  ('/images/trust1.jpg', ARRAY['warm', 'caring'], 'TRUST & VULNERABILITY', 'nature'),
  ('/images/flow1.jpg', ARRAY['intuitive', 'wise'], 'COMPATIBILITY FLOW', 'abstract');
```

4. Click **"Run"**

Now all 5 images are added at once!

---

## 🔧 Advanced: Controlling Which Image Shows

By default, the system picks images automatically by category. If you want to force a specific image for a specific card:

### Step 1: Find the IDs
Go to Supabase Table Editor:
- Open **"archetypes"** table and note the `id` of the card (e.g., "The Joy Bringer")
- Open **"illustrations"** table and note the `id` of the image you want

### Step 2: Create a mapping
Go to **"illustration_mappings"** table and insert:
- archetype_id: `[the card's id]`
- illustration_id: `[the image's id]`
- priority: `100` (higher number = shows first)

---

## ❓ FAQ

**Q: Where should I host my images?**
A: Anywhere - Supabase Storage, Cloudinary, AWS S3, or just in your `/public` folder

**Q: What if I don't set a category?**
A: The image won't automatically show on any card. You'll need to manually map it.

**Q: Can one image show on multiple cards?**
A: Yes! Just give it a category, or create multiple mappings.

**Q: How do I change an image?**
A: Go to "illustrations" table, click the row, edit the URL, save.

**Q: How do I delete an image?**
A: Go to "illustrations" table, click the row, click the trash icon.

---

## 📝 Summary

**To add images:** Supabase Dashboard → Table Editor → illustrations → Insert row
**Images automatically match** cards by category
**To add many at once:** Use SQL Editor with INSERT statement
**To control exactly which shows:** Use illustration_mappings table
