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
 * Word-wraps text into multiple lines based on maximum character width per line.
 * Avoids breaking words across lines.
 */
export function wrapText(text: string, maxCharsPerLine: number = 44, maxLines: number = 3): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (!currentLine) {
      currentLine = word;
    } else if ((currentLine + ' ' + word).length <= maxCharsPerLine) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
      if (lines.length === maxLines - 1) {
        break;
      }
    }
  }

  if (currentLine) {
    // If there were remaining words beyond maxLines, append ellipsis to last line
    const remainingWords = words.slice(words.indexOf(currentLine.split(/\s+/)[0]) + currentLine.split(/\s+/).length);
    if (remainingWords.length > 0 && lines.length === maxLines - 1) {
      currentLine += '…';
    }
    lines.push(currentLine);
  }

  return lines.slice(0, maxLines);
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
 * - Natural multi-line text wrapping so full sentiments are read clearly without unnatural animations
 * - Dynamic card height adapting to content while preserving strict margins and dividers
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

  // Guarantee 5 rows
  const rows: Array<Sentiment | null> = [...sentiments];
  while (rows.length < 5) {
    rows.push(null);
  }

  const fontQuote =
    themeVariant === 'modern'
      ? '-apple-system, BlinkMacSystemFont, "Geist Sans", "Segoe UI", Roboto, sans-serif'
      : '"Instrument Serif", Newsreader, Georgia, serif';

  const quoteStyle = themeVariant === 'modern' ? 'normal' : 'italic';
  const quoteWeight = themeVariant === 'modern' ? '500' : 'normal';
  const quoteSize = themeVariant === 'modern' ? '13px' : '15px';
  const lineHeight = themeVariant === 'modern' ? 18 : 20;

  // Max characters before wrapping to a new line in quote column
  const maxChars = themeVariant === 'modern' ? 46 : 43;

  // Pre-calculate heights and positions for all 5 rows
  let currentY = 58;
  const renderedRows: string[] = [];

  rows.slice(0, 5).forEach((sentiment, index) => {
    const num = String(index + 1).padStart(2, '0');

    if (!sentiment) {
      const rowHeight = 46;
      const textY = currentY + 28;
      const dividerY = currentY + rowHeight;

      renderedRows.push(`
    <!-- Row ${index + 1} (Empty Slot) -->
    <g>
      <text x="24" y="${textY}" class="num">${num}</text>
      <text x="56" y="${textY}" class="quote empty">— Awaiting inscription —</text>
      <text x="536" y="${textY}" text-anchor="end" class="meta">—</text>
    </g>
    ${index < 4 && themeVariant !== 'minimal' ? `<line x1="24" y1="${dividerY}" x2="536" y2="${dividerY}" stroke="${p.divider}" stroke-width="1" />` : ''}
      `.trim());

      currentY += rowHeight;
      return;
    }

    const safeAlias = escapeXml(sentiment.author_alias);
    const safeDate = formatTimestamp(sentiment.created_at);
    const isPinned = sentiment.is_pinned === 1;

    // Wrap quote text into up to 3 lines
    const lines = wrapText(sentiment.content, maxChars, 3);
    const numLines = lines.length;

    // Calculate row height based on line count:
    // 1 line: 48px, 2 lines: 66px, 3 lines: 84px
    const rowHeight = 32 + numLines * lineHeight;
    const dividerY = currentY + rowHeight;
    const firstLineY = currentY + 24;

    // Format multiline tspans
    const tspans = lines.map((line, lineIdx) => {
      const isFirst = lineIdx === 0;
      const isLast = lineIdx === numLines - 1;
      const contentWithQuotes = `${isFirst ? '“' : ''}${escapeXml(line)}${isLast ? '”' : ''}`;
      if (lineIdx === 0) {
        return `<tspan x="56" y="${firstLineY}">${contentWithQuotes}</tspan>`;
      }
      return `<tspan x="56" dy="${lineHeight}">${contentWithQuotes}</tspan>`;
    }).join('');

    renderedRows.push(`
    <!-- Row ${index + 1} (${numLines} lines) -->
    <g>
      <text x="24" y="${firstLineY}" class="num">${num}</text>
      <text class="quote">
        ${tspans}
      </text>
      <text x="536" y="${firstLineY}" text-anchor="end" class="meta">
        ${isPinned ? `<tspan fill="${p.star}" font-weight="600">★ </tspan>` : ''}@${safeAlias} <tspan fill="${p.pipe}">|</tspan> ${safeDate}
      </text>
    </g>
    ${index < 4 && themeVariant !== 'minimal' ? `<line x1="24" y1="${dividerY}" x2="536" y2="${dividerY}" stroke="${p.divider}" stroke-width="1" />` : ''}
    `.trim());

    currentY += rowHeight;
  });

  // Calculate total card height dynamically based on rendered rows
  const footerLineY = currentY + 12;
  const footerTextY = footerLineY + 20;
  const totalHeight = footerTextY + 20;

  // Header emblem color
  const emblemColor = p.headerTitle;
  const showEmblem = themeVariant !== 'minimal';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 ${totalHeight}" width="560" height="${totalHeight}" role="img" aria-label="Sentigraph - ${safeUsername}">
  <style>
    .bg { fill: ${p.bg}; }
    .card-border { stroke: ${p.border}; stroke-width: 1; fill: none; }
    .header-title { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Geist Sans", sans-serif; font-size: 11px; font-weight: 700; fill: ${p.headerTitle}; letter-spacing: 2px; text-transform: uppercase; }
    .header-badge { font-family: "Geist Mono", "JetBrains Mono", "SF Mono", monospace; font-size: 9px; fill: ${p.headerBadge}; letter-spacing: 1.5px; text-transform: uppercase; }
    .num { font-family: "Geist Mono", "JetBrains Mono", "SF Mono", monospace; font-size: 11px; fill: ${p.num}; letter-spacing: 0.5px; }
    .quote { font-family: ${fontQuote}; font-size: ${quoteSize}; font-style: ${quoteStyle}; font-weight: ${quoteWeight}; fill: ${p.quote}; }
    .quote.empty { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-style: normal; font-size: 12px; fill: ${p.quoteEmpty}; letter-spacing: 0.5px; }
    .meta { font-family: "Geist Mono", "JetBrains Mono", "SF Mono", monospace; font-size: 10px; fill: ${p.meta}; letter-spacing: 0.5px; }
    .footer-text { font-family: "Geist Mono", "JetBrains Mono", "SF Mono", monospace; font-size: 9px; fill: ${p.footerText}; letter-spacing: 1.5px; text-transform: uppercase; }
    .footer-link { font-family: "Geist Mono", "JetBrains Mono", "SF Mono", monospace; font-size: 9px; fill: ${p.footerLink}; letter-spacing: 1px; }
  </style>

  <!-- Background Surface -->
  <rect width="560" height="${totalHeight}" class="bg" rx="2" ry="2" />
  <rect x="0.5" y="0.5" width="559" height="${totalHeight - 1}" class="card-border" rx="2" ry="2" />

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
    ${renderedRows.join('\n    ')}
  </g>

  <!-- Broadside Footer -->
  <line x1="24" y1="${footerLineY}" x2="536" y2="${footerLineY}" stroke="${p.divider}" stroke-width="1" />
  <g transform="translate(24, ${footerTextY})">
    <text x="0" y="0" class="footer-text">BROADSIDE PRESS <tspan fill="${p.pipe}">■</tspan> LIVE INSCRIPTION SURFACE</text>
    <text x="512" y="0" text-anchor="end" class="footer-link">CLICK CARD TO LEAVE A NOTE →</text>
  </g>
</svg>`;
}
