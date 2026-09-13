import { Sentiment, ThemeVariant, ColorMode } from './db.js';

/**
 * Escapes XML / SVG entities to preserve typographic integrity and prevent injection.
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Formats ISO timestamp to concise editorial date (e.g. "OCT 24").
 */
export function formatTimestamp(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}`;
  } catch {
    return 'RECENT';
  }
}

export interface RenderCardOptions {
  username: string;
  sentiments: Sentiment[];
  feedMode: 'latest' | 'curated';
  themeVariant?: ThemeVariant;
  colorMode?: ColorMode;
}

interface ThemePalette {
  bg: string;
  border: string;
  divider: string;
  headerTitle: string;
  headerBadge: string;
  num: string;
  quote: string;
  quoteEmpty: string;
  meta: string;
  star: string;
  pipe: string;
  footerText: string;
  footerLink: string;
}

const PALETTES: Record<ColorMode, ThemePalette> = {
  dark: {
    bg: '#0A0A0A',
    border: '#262626',
    divider: '#262626',
    headerTitle: '#EDEDED',
    headerBadge: '#737373',
    num: '#525252',
    quote: '#EDEDED',
    quoteEmpty: '#404040',
    meta: '#737373',
    star: '#EDEDED',
    pipe: '#3D3D3D',
    footerText: '#525252',
    footerLink: '#8A8A8A'
  },
  light: {
    bg: '#F7F6F2',
    border: '#D8D5CD',
    divider: '#D8D5CD',
    headerTitle: '#171717',
    headerBadge: '#7A7873',
    num: '#8E8B83',
    quote: '#171717',
    quoteEmpty: '#A8A59E',
    meta: '#7A7873',
    star: '#171717',
    pipe: '#BFBCB4',
    footerText: '#8E8B83',
    footerLink: '#5A5853'
  }
};

/**
 * High-performance, zero-headless-browser SVG card renderer adhering to
 * broadside typography, Swiss modernist grid discipline, and strict editorial palette.
 * Supports:
 * - 3 minimalist layout options (broadside, minimal, modern)
 * - Dark & Light broadsheet canvas modes
 * - Smooth CSS infinite marquee motion for overflowing sentiments so quotes are NEVER cut off.
 * - Dedicated metadata column to prevent overlapping text.
 * 
 * Target dimensions: 560px × 380px.
 */
export function renderCardSvg({
  username,
  sentiments,
  feedMode,
  themeVariant = 'broadside',
  colorMode = 'dark'
}: RenderCardOptions): string {
  const safeUsername = escapeXml(username.toUpperCase());
  const safeMode = escapeXml(feedMode.toUpperCase());
  const p = PALETTES[colorMode] || PALETTES.dark;

  // Fill array to guarantee 5 rows
  const rows: Array<Sentiment | null> = [...sentiments];
  while (rows.length < 5) {
    rows.push(null);
  }

  const startY = 60;
  const rowHeight = 54;
  const quoteViewportWidth = 350; // Visible window width for quote text

  const fontQuote =
    themeVariant === 'modern'
      ? '-apple-system, BlinkMacSystemFont, "Geist Sans", "Segoe UI", Roboto, sans-serif'
      : '"Instrument Serif", Newsreader, Georgia, serif';

  const quoteStyle = themeVariant === 'modern' ? 'normal' : 'italic';
  const quoteWeight = themeVariant === 'modern' ? '500' : 'normal';
  const quoteSize = themeVariant === 'modern' ? '13px' : '15px';

  // Build rows and collect keyframes for overflowing text
  const keyframes: string[] = [];

  const rowElements = rows.slice(0, 5).map((sentiment, index) => {
    const y = startY + index * rowHeight;
    const dividerY = y + rowHeight;
    const num = String(index + 1).padStart(2, '0');

    if (!sentiment) {
      return `
    <!-- Row ${index + 1} (Empty Slot) -->
    <g transform="translate(0, ${y})">
      <text x="24" y="32" class="num">${num}</text>
      <text x="56" y="32" class="quote empty">— Awaiting inscription —</text>
      <text x="536" y="32" text-anchor="end" class="meta">—</text>
    </g>
    ${index < 4 && themeVariant !== 'minimal' ? `<line x1="24" y1="${dividerY}" x2="536" y2="${dividerY}" stroke="${p.divider}" stroke-width="1" />` : ''}
      `.trim();
    }

    const safeAlias = escapeXml(sentiment.author_alias);
    const safeContent = escapeXml(sentiment.content);
    const safeDate = formatTimestamp(sentiment.created_at);
    const isPinned = sentiment.is_pinned === 1;

    // Approximate character length threshold where text exceeds 350px width
    // At ~15px serif font, average character is ~7.5px. ~46 characters fill 350px.
    const isOverflowing = sentiment.content.length > 46;

    let quoteSvg: string;

    if (isOverflowing) {
      const animName = `marquee-${index + 1}`;
      // Calculate travel distance based on character count:
      // total text width approx: chars * 7.8px
      // travel distance = textWidth - viewportWidth + buffer
      const estimatedWidth = Math.round(sentiment.content.length * 8.2);
      const shiftX = -(estimatedWidth - quoteViewportWidth + 24);
      // Duration proportional to length (smooth readable crawl ~14-22s)
      const duration = Math.min(24, Math.max(12, Math.round(sentiment.content.length * 0.16)));

      keyframes.push(`
    @keyframes ${animName} {
      0%, 15% { transform: translateX(0px); }
      75%, 85% { transform: translateX(${shiftX}px); }
      95%, 100% { transform: translateX(0px); }
    }
    .anim-row-${index + 1} {
      animation: ${animName} ${duration}s ease-in-out infinite alternate;
    }
      `.trim());

      quoteSvg = `
      <g clip-path="url(#quote-clip-${index + 1})">
        <g class="anim-row-${index + 1}">
          <text x="0" y="32" class="quote">“${safeContent}”</text>
        </g>
      </g>`;
    } else {
      quoteSvg = `
      <text x="0" y="32" class="quote">“${safeContent}”</text>`;
    }

    return `
    <!-- Row ${index + 1} -->
    <g transform="translate(0, ${y})">
      <text x="24" y="32" class="num">${num}</text>
      <!-- Quote Column (x: 56 to 406) -->
      <g transform="translate(56, 0)">
        ${quoteSvg}
      </g>
      <!-- Metadata Column (x: 412 to 536) -->
      <text x="536" y="32" text-anchor="end" class="meta">
        ${isPinned ? `<tspan fill="${p.star}" font-weight="600">★ </tspan>` : ''}@${safeAlias} <tspan fill="${p.pipe}">|</tspan> ${safeDate}
      </text>
    </g>
    ${index < 4 && themeVariant !== 'minimal' ? `<line x1="24" y1="${dividerY}" x2="536" y2="${dividerY}" stroke="${p.divider}" stroke-width="1" />` : ''}
    `.trim();
  }).join('\n    ');

  // Clip paths for each row so moving text stays neatly bounded inside the quote column
  const clipPaths = [0, 1, 2, 3, 4].map((i) => {
    const y = startY + i * rowHeight;
    return `<clipPath id="quote-clip-${i + 1}"><rect x="0" y="0" width="${quoteViewportWidth}" height="54" /></clipPath>`;
  }).join('\n    ');

  // Emblem icon in header
  const emblemColor = p.headerTitle;
  const showEmblem = themeVariant !== 'minimal';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 380" width="560" height="380" role="img" aria-label="Sentigraph - ${safeUsername}">
  <defs>
    ${clipPaths}
  </defs>

  <style>
    .bg { fill: ${p.bg}; }
    .card-border { stroke: ${p.border}; stroke-width: 1; fill: none; }
    .header-title { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Geist Sans", sans-serif; font-size: 11px; font-weight: 700; fill: ${p.headerTitle}; letter-spacing: 2px; text-transform: uppercase; }
    .header-badge { font-family: "Geist Mono", "JetBrains Mono", "SF Mono", monospace; font-size: 9px; fill: ${p.headerBadge}; letter-spacing: 1.5px; text-transform: uppercase; }
    .num { font-family: "Geist Mono", "JetBrains Mono", "SF Mono", monospace; font-size: 11px; fill: ${p.num}; letter-spacing: 0.5px; }
    .quote { font-family: ${fontQuote}; font-size: ${quoteSize}; font-style: ${quoteStyle}; font-weight: ${quoteWeight}; fill: ${p.quote}; white-space: nowrap; }
    .quote.empty { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-style: normal; font-size: 12px; fill: ${p.quoteEmpty}; letter-spacing: 0.5px; }
    .meta { font-family: "Geist Mono", "JetBrains Mono", "SF Mono", monospace; font-size: 10px; fill: ${p.meta}; letter-spacing: 0.5px; }
    .footer-text { font-family: "Geist Mono", "JetBrains Mono", "SF Mono", monospace; font-size: 9px; fill: ${p.footerText}; letter-spacing: 1.5px; text-transform: uppercase; }
    .footer-link { font-family: "Geist Mono", "JetBrains Mono", "SF Mono", monospace; font-size: 9px; fill: ${p.footerLink}; letter-spacing: 1px; }

    ${keyframes.join('\n    ')}
  </style>

  <!-- Background Surface -->
  <rect width="560" height="380" class="bg" rx="2" ry="2" />
  <rect x="0.5" y="0.5" width="559" height="379" class="card-border" rx="2" ry="2" />

  <!-- Broadside Masthead / Header -->
  <g transform="translate(24, 24)">
    ${
      showEmblem
        ? `<!-- Vector Broadside Emblem -->
    <g transform="translate(0, 0)">
      <path d="M0 2 C4 0, 10 0, 14 3 L14 15 C10 12, 4 12, 0 14 Z" fill="none" stroke="${emblemColor}" stroke-width="1.2" />
      <path d="M14 3 C18 0, 24 0, 28 2 L28 14 C24 12, 18 12, 14 15 Z" fill="none" stroke="${emblemColor}" stroke-width="1.2" />
      <path d="M14 1 L14 16" stroke="${emblemColor}" stroke-width="1" />
      <path d="M14 0 L16 7 L14 12 L12 7 Z" fill="${emblemColor}" />
    </g>
    <text x="36" y="12" class="header-title">SENTIGRAPH <tspan fill="${p.pipe}">/</tspan> ${safeUsername}</text>`
        : `<text x="0" y="12" class="header-title">SENTIGRAPH <tspan fill="${p.pipe}">/</tspan> ${safeUsername}</text>`
    }
    <text x="512" y="12" text-anchor="end" class="header-badge">EDITION: ${safeMode}</text>
  </g>
  <line x1="24" y1="46" x2="536" y2="46" stroke="${p.divider}" stroke-width="1" />

  <!-- 5 Sentiment Rows -->
  <g id="sentiments-group">
    ${rowElements}
  </g>

  <!-- Broadside Footer -->
  <line x1="24" y1="340" x2="536" y2="340" stroke="${p.divider}" stroke-width="1" />
  <g transform="translate(24, 360)">
    <text x="0" y="0" class="footer-text">BROADSIDE PRESS <tspan fill="${p.pipe}">■</tspan> LIVE INSCRIPTION SURFACE</text>
    <text x="512" y="0" text-anchor="end" class="footer-link">CLICK CARD TO LEAVE A NOTE →</text>
  </g>
</svg>`;
}
