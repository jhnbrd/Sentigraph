<p align="center">
  <img src="assets/sentigraph_banner.jpg" alt="Sentigraph Banner" width="760" />
</p>

<p align="center">
  <strong>Editorial micro-publishing service & interactive guestbook for developer profiles.</strong><br>
  <em>Turn your GitHub profile README into an ink-printed broadside sentiment wall.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Service-Sentigraph-EDEDED?style=flat-square&labelColor=0A0A0A" alt="Sentigraph">
  <img src="https://img.shields.io/badge/Card-Dynamic_SVG-blue?style=flat-square" alt="Dynamic SVG">
  <img src="https://img.shields.io/badge/Cache_Busting-Strict_No--Cache-green?style=flat-square" alt="No Cache">
  <img src="https://img.shields.io/badge/License-MIT-lightgrey?style=flat-square" alt="MIT License">
</p>

---

## 1. What is Sentigraph?

**Sentigraph** gives your GitHub profile an interactive sentiment marquee. It serves a live, dynamically compiled SVG card directly inside your GitHub profile `README.md`.

When someone visits your GitHub profile and clicks the card, they are directed to your public inscription portal where they can leave a short recommendation, endorsement, or note (up to 180 characters). New entries instantly appear on your broadside card formatted with natural multi-line typography and adaptive row heights so full sentiments are read clearly without awkward truncation or moving text.

```text
Visitor on your GitHub README ──► Clicks Card ──► Public Submission Portal
               ▲                                            │
               └────────── Live SVG Updates ◄───────────────┘
```

---

## 2. How to Use Sentigraph (Service Guide)

### Step 1: Create your Curator Account
1. Open the Curator Console at [`/dashboard`](http://127.0.0.1:8072/dashboard).
2. Enter your desired handle (e.g. your GitHub username) and password.
3. Click **Register** to establish your registry profile.

### Step 2: Embed the Card into your GitHub Profile README
Once logged in to `/dashboard`, copy your ready-to-paste Markdown embed snippet:

```markdown
[![Sentigraph](https://sentigraph.jhnbrd.com/api/card/YOUR_USERNAME)](https://sentigraph.jhnbrd.com/u/YOUR_USERNAME)
```

Add this snippet anywhere in your GitHub profile repository (`username/username/README.md`). 

Whenever visitors click your card on GitHub, they land directly on your dedicated broadside writing portal (`/u/YOUR_USERNAME`).

---

## 3. Choosing Your Aesthetic & Canvas

Inside your Curator Console, you can customize how your inscription card is presented:

### Three Minimalist Layout Variants
1. **Broadside Editorial**: Classic literary printing press styling with high-contrast serif quotes, hairline etched dividers, and the brand emblem.
2. **Pure Minimal**: Serif typography with generous negative space, pure whitespace breathing room, and zero dividing lines.
3. **Modern Grotesque**: Swiss clean geometric grotesque typography with sharp utilitarian rules.

### Canvas Modes
- **● Dark Canvas**: Pitch Carbon (`#0A0A0A`) background with bleached paper typography (`#EDEDED`).
- **○ Light Canvas**: Unbleached broadsheet paper (`#F7F6F2`) with high-density printing ink (`#171717`).

---

## 4. Live & Sample Previewing

In the **Curator's Console (`/dashboard`)**, two real-time previews are rendered side-by-side:

1. **Live Feed Preview (Actual Data)**:
   - Reflects the exact card currently visible on your GitHub README.
   - Shows empty inscription slots waiting for new entries if you have fewer than 5 notes.
2. **Inscription Sample Preview (Simulated Data)**:
   - Renders simulated quotes from historical computing pioneers (Ada Lovelace, Alan Turing, Grace Hopper, Linus Torvalds, Ken Thompson).
   - Allows you to preview how your chosen aesthetic and color mode look when completely filled before sharing your card publicly.

---

## 5. Feed Curation & Moderation

### Display Policies
- **Display Mode 1: Chronological**: Automatically renders the 5 most recent unhidden sentiments submitted by your visitors.
- **Display Mode 2: Handpicked / Curated**: Pin up to 5 specific endorsements to numbered slots (`★ Slot 1` to `★ Slot 5`). Unassigned slots automatically backfill with recent notes.

### Moderation
- **Strike / Hide**: Instantly hide inappropriate entries or spam from your public SVG card without permanently deleting them from your database.
- **Restore**: Easily unhide previously struck messages at any time.

---

## 6. Technical Specifications

- **Zero-Browser Vector Engine**: Direct SVG string construction with XML entity escaping and word-boundary truncation. Zero headless browser dependencies (no Puppeteer/Playwright).
- **GitHub Camo Proxy Cache Busting**: Sends strict invalidation headers (`Cache-Control: no-cache, no-store, must-revalidate, max-age=0`, `Pragma: no-cache`, `Expires: 0`) to guarantee fresh sentiments.
- **Engine**: TypeScript, Hono, and native `node:sqlite` in WAL mode (zero native C++ compilation dependencies).
- **Default Port**: `8072`.

---

## 7. License

This project is licensed under the [MIT License](LICENSE) © 2026 Sentigraph.
