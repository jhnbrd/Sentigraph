import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { queries, hashPassword, verifyPassword, Sentiment } from './db.js';
import { renderCardSvg, escapeXml } from './svg.js';
import { randomBytes } from 'node:crypto';

const app = new Hono();

// Simple in-memory session map: token -> userId (low memory overhead, perfect for single host)
const sessions = new Map<string, { userId: string; expires: number }>();

function createSession(userId: string, rememberMe: boolean = false): { token: string; maxAgeSeconds: number } {
  const token = randomBytes(24).toString('hex');
  // 30 days if Remember Me, else 24 hours
  const maxAgeSeconds = rememberMe ? 60 * 60 * 24 * 30 : 60 * 60 * 24;
  const expires = Date.now() + maxAgeSeconds * 1000;
  sessions.set(token, { userId, expires });
  return { token, maxAgeSeconds };
}

function getUserIdFromSession(token?: string): string | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expires) {
    sessions.delete(token);
    return null;
  }
  return session.userId;
}

// ---------------------------------------------------------------------------
// 0. Branding & Favicon Endpoints
// ---------------------------------------------------------------------------
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="4" fill="#0A0A0A" />
  <rect x="0.5" y="0.5" width="31" height="31" rx="4" stroke="#262626" fill="none" />
  <g transform="translate(4, 7)">
    <path d="M0 2 C3 0, 8 0, 12 3 L12 14 C8 11, 3 11, 0 13 Z" fill="none" stroke="#EDEDED" stroke-width="1.3" />
    <path d="M12 3 C16 0, 21 0, 24 2 L24 13 C21 11, 16 11, 12 14 Z" fill="none" stroke="#EDEDED" stroke-width="1.3" />
    <path d="M12 1 L12 15" stroke="#EDEDED" stroke-width="1" />
    <path d="M12 0 L14.5 6 L12 11 L9.5 6 Z" fill="#EDEDED" />
  </g>
</svg>`;

app.get('/favicon.ico', (c) => {
  c.header('Content-Type', 'image/svg+xml');
  return c.body(LOGO_SVG);
});

app.get('/favicon.svg', (c) => {
  c.header('Content-Type', 'image/svg+xml');
  return c.body(LOGO_SVG);
});

// ---------------------------------------------------------------------------
// 1. Inscription Surface: Dynamic SVG Endpoint
// ---------------------------------------------------------------------------
const SAMPLE_SENTIMENTS: Sentiment[] = [
  {
    id: 'sample-1',
    user_id: 'sample',
    author_alias: 'linus',
    content: 'Talk is cheap. Show me the code. Exceptional taste in design and system craft.',
    is_pinned: 1,
    pin_order: 1,
    is_hidden: 0,
    created_at: new Date().toISOString()
  },
  {
    id: 'sample-2',
    user_id: 'sample',
    author_alias: 'ada',
    content: 'The analytical engine weaves algebraical patterns just as the Jacquard loom weaves flowers.',
    is_pinned: 0,
    pin_order: 0,
    is_hidden: 0,
    created_at: new Date(Date.now() - 86400000).toISOString()
  },
  {
    id: 'sample-3',
    user_id: 'sample',
    author_alias: 'turing',
    content: 'We can only see a short distance ahead, but we can see plenty there that needs to be done.',
    is_pinned: 0,
    pin_order: 0,
    is_hidden: 0,
    created_at: new Date(Date.now() - 172800000).toISOString()
  },
  {
    id: 'sample-4',
    user_id: 'sample',
    author_alias: 'hopper',
    content: 'The most dangerous phrase in the language is: We have always done it this way.',
    is_pinned: 0,
    pin_order: 0,
    is_hidden: 0,
    created_at: new Date(Date.now() - 259200000).toISOString()
  },
  {
    id: 'sample-5',
    user_id: 'sample',
    author_alias: 'ritchie',
    content: 'UNIX is basically a simple operating system, but you have to be a genius to understand the simplicity.',
    is_pinned: 0,
    pin_order: 0,
    is_hidden: 0,
    created_at: new Date(Date.now() - 345600000).toISOString()
  }
];

app.get('/api/card/:username', (c) => {
  const username = c.req.param('username');
  const user = queries.getUserByUsername(username);
  const isSample = c.req.query('sample') === '1' || c.req.query('sample') === 'true';

  // Allow URL override for previewing or default to user profile settings
  const theme = (c.req.query('theme') as any) || user?.theme_variant || 'broadside';
  const mode = (c.req.query('mode') as any) || user?.color_mode || 'dark';

  // Set strict headers to bust GitHub Camo caching unconditionally
  c.header('Content-Type', 'image/svg+xml; charset=utf-8');
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');

  if (isSample) {
    const svg = renderCardSvg({
      username: username || 'DEMO',
      sentiments: SAMPLE_SENTIMENTS,
      feedMode: user?.feed_mode || 'latest',
      themeVariant: theme,
      colorMode: mode
    });
    return c.body(svg);
  }

  if (!user) {
    const fallbackSvg = renderCardSvg({
      username: username || 'UNKNOWN',
      sentiments: [],
      feedMode: 'latest',
      themeVariant: theme,
      colorMode: mode
    });
    return c.body(fallbackSvg);
  }

  const sentiments = queries.getSentimentsForCard(user.id, user.feed_mode);
  const svg = renderCardSvg({
    username: user.username,
    sentiments,
    feedMode: user.feed_mode,
    themeVariant: theme,
    colorMode: mode
  });

  return c.body(svg);
});

// ---------------------------------------------------------------------------
// 2. Public Broadside: Submission API
// ---------------------------------------------------------------------------
app.post('/api/sentiment/:username', async (c) => {
  const username = c.req.param('username');
  const user = queries.getUserByUsername(username);

  if (!user) {
    return c.json({ error: 'Recipient user not found' }, 404);
  }

  try {
    const body = await c.req.json().catch(async () => {
      // Fallback to form data parsing if submitted via plain HTML form
      const form = await c.req.formData();
      return {
        author_alias: form.get('author_alias')?.toString() || '',
        content: form.get('content')?.toString() || ''
      };
    });

    const content = (body.content || '').trim();
    const authorAlias = (body.author_alias || '').trim() || 'Anonymous';

    if (!content) {
      return c.json({ error: 'Sentiment content cannot be blank' }, 400);
    }

    if (content.length > 180) {
      return c.json({ error: 'Sentiment exceeds 180 character limit' }, 400);
    }

    const newSentiment = queries.addSentiment(user.id, authorAlias, content);
    return c.json({ success: true, sentiment: newSentiment }, 201);
  } catch (err: any) {
    return c.json({ error: 'Invalid submission payload', message: err.message }, 400);
  }
});

// ---------------------------------------------------------------------------
// 3. Public Broadside: Submission Portal Webpage (/u/:username)
// ---------------------------------------------------------------------------
app.get('/u/:username', (c) => {
  const username = c.req.param('username');
  const user = queries.getUserByUsername(username);

  const safeUser = escapeXml(username);
  const userExists = !!user;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Leave an Inscription / ${safeUser} — Sentigraph</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="alternate icon" href="/favicon.ico" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #0A0A0A;
      color: #EDEDED;
      font-family: -apple-system, BlinkMacSystemFont, "Geist Sans", "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      line-height: 1.5;
    }
    .broadside-frame {
      width: 100%;
      max-width: 520px;
      background: #121212;
      border: 1px solid #262626;
      border-radius: 2px;
      padding: 36px 32px;
    }
    .masthead {
      border-bottom: 1px solid #262626;
      padding-bottom: 18px;
      margin-bottom: 28px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .masthead-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .masthead-logo {
      width: 26px;
      height: 26px;
      flex-shrink: 0;
    }
    .masthead h1 {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #EDEDED;
    }
    .masthead span {
      font-family: "Geist Mono", monospace;
      font-size: 10px;
      color: #737373;
      letter-spacing: 1px;
    }
    .intro {
      font-family: "Instrument Serif", Georgia, serif;
      font-size: 19px;
      font-style: italic;
      color: #D4D4D4;
      margin-bottom: 24px;
    }
    label {
      display: block;
      font-family: "Geist Mono", monospace;
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #737373;
      margin-bottom: 8px;
      margin-top: 18px;
    }
    input[type="text"], textarea {
      width: 100%;
      background: #0A0A0A;
      border: 1px solid #262626;
      color: #EDEDED;
      border-radius: 0;
      padding: 12px 14px;
      font-size: 14px;
      font-family: inherit;
      transition: border-color 0.15s ease;
    }
    textarea {
      font-family: "Instrument Serif", Georgia, serif;
      font-size: 17px;
      font-style: italic;
      resize: vertical;
      min-height: 90px;
    }
    input[type="text"]:focus, textarea:focus {
      outline: none;
      border-color: #555555;
    }
    .counter {
      font-family: "Geist Mono", monospace;
      font-size: 10px;
      color: #525252;
      text-align: right;
      margin-top: 4px;
    }
    button {
      margin-top: 24px;
      width: 100%;
      padding: 14px;
      background: #EDEDED;
      color: #0A0A0A;
      border: 1px solid #EDEDED;
      font-family: "Geist Mono", monospace;
      font-size: 11px;
      letter-spacing: 2px;
      text-transform: uppercase;
      font-weight: 700;
      cursor: pointer;
      border-radius: 0;
      transition: background 0.15s ease, color 0.15s ease;
    }
    button:hover {
      background: #FFFFFF;
      color: #000000;
    }
    .status {
      margin-top: 16px;
      font-family: "Geist Mono", monospace;
      font-size: 11px;
      text-align: center;
      display: none;
    }
    .status.success { color: #A3E635; display: block; }
    .status.error { color: #F87171; display: block; }
    .preview-link {
      margin-top: 24px;
      text-align: center;
      font-family: "Geist Mono", monospace;
      font-size: 10px;
      color: #737373;
    }
    .preview-link a {
      color: #A3A3A3;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
  </style>
</head>
<body>
  <div class="broadside-frame">
    <div class="masthead">
      <div class="masthead-brand">
        <svg class="masthead-logo" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="4" fill="#0A0A0A" />
          <rect x="0.5" y="0.5" width="31" height="31" rx="4" stroke="#262626" />
          <g transform="translate(4, 7)">
            <path d="M0 2 C3 0, 8 0, 12 3 L12 14 C8 11, 3 11, 0 13 Z" fill="none" stroke="#EDEDED" stroke-width="1.3" />
            <path d="M12 3 C16 0, 21 0, 24 2 L24 13 C21 11, 16 11, 12 14 Z" fill="none" stroke="#EDEDED" stroke-width="1.3" />
            <path d="M12 1 L12 15" stroke="#EDEDED" stroke-width="1" />
            <path d="M12 0 L14.5 6 L12 11 L9.5 6 Z" fill="#EDEDED" />
          </g>
        </svg>
        <h1>Sentigraph</h1>
      </div>
      <span>DESTINATION: /${safeUser}</span>
    </div>

    ${
      !userExists
        ? `<p style="color: #737373; font-family: monospace; font-size: 12px;">This curator profile does not exist yet. Registered curator profiles can receive inscriptions.</p>
           <div class="preview-link" style="margin-top: 20px;"><a href="/dashboard">Create or Log in to Curator Console →</a></div>`
        : `
    <p class="intro">Inscribe a note, recommendation, or sentiment to be dynamically set in ink on ${safeUser}’s GitHub README broadside.</p>

    <form id="sentiment-form">
      <label for="content">The Inscription (Max 180 Characters)</label>
      <textarea id="content" name="content" maxlength="180" placeholder="A sharp mind and a rare craftsman in systems programming..." required></textarea>
      <div class="counter"><span id="char-count">0</span> / 180</div>

      <label for="author_alias">Your Alias or Handle</label>
      <input type="text" id="author_alias" name="author_alias" maxlength="32" placeholder="e.g. torvalds, Ada, or Anonymous" />

      <button type="submit" id="submit-btn">Cast Inscription</button>
      <div id="status" class="status"></div>
    </form>

    <div class="preview-link">
      <a href="/api/card/${safeUser}" target="_blank">Inspect Current Live Broadside Card ↗</a>
    </div>
    `
    }
  </div>

  <script>
    const form = document.getElementById('sentiment-form');
    const contentInput = document.getElementById('content');
    const charCount = document.getElementById('char-count');
    const statusDiv = document.getElementById('status');
    const submitBtn = document.getElementById('submit-btn');

    if (contentInput) {
      contentInput.addEventListener('input', () => {
        charCount.textContent = contentInput.value.length;
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        submitBtn.disabled = true;
        submitBtn.textContent = 'Setting in Type...';
        statusDiv.className = 'status';
        statusDiv.style.display = 'none';

        try {
          const res = await fetch('/api/sentiment/${safeUser}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: contentInput.value,
              author_alias: document.getElementById('author_alias').value
            })
          });
          const data = await res.json();
          if (res.ok) {
            statusDiv.textContent = '✓ Note successfully recorded. It is now queued for broadside publication.';
            statusDiv.className = 'status success';
            form.reset();
            charCount.textContent = '0';
          } else {
            statusDiv.textContent = '✗ ' + (data.error || 'Failed to submit sentiment.');
            statusDiv.className = 'status error';
          }
        } catch (err) {
          statusDiv.textContent = '✗ Network transmission error.';
          statusDiv.className = 'status error';
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Cast Inscription';
        }
      });
    }
  </script>
</body>
</html>`;

  return c.html(html);
});

// ---------------------------------------------------------------------------
// 4. Curator's Console: Authentication & Dashboard Routes
// ---------------------------------------------------------------------------

// Auth: Register / Login API
app.post('/api/auth/register', async (c) => {
  const { username, password, rememberMe } = await c.req.json();
  if (!username || !password || username.length < 2 || password.length < 6) {
    return c.json({ error: 'Username must be >= 2 chars, password >= 6 chars' }, 400);
  }

  const existing = queries.getUserByUsername(username);
  if (existing) {
    return c.json({ error: 'Username already taken' }, 409);
  }

  const hash = hashPassword(password);
  const newUser = queries.createUser(username, hash);
  const { token, maxAgeSeconds } = createSession(newUser.id, !!rememberMe);

  setCookie(c, 'sentigraph_session', token, {
    httpOnly: true,
    path: '/',
    maxAge: maxAgeSeconds,
    sameSite: 'Lax'
  });

  return c.json({ success: true, username: newUser.username });
});

app.post('/api/auth/login', async (c) => {
  const { username, password, rememberMe } = await c.req.json();
  const user = queries.getUserByUsername(username);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const { token, maxAgeSeconds } = createSession(user.id, !!rememberMe);
  setCookie(c, 'sentigraph_session', token, {
    httpOnly: true,
    path: '/',
    maxAge: maxAgeSeconds,
    sameSite: 'Lax'
  });

  return c.json({ success: true, username: user.username });
});

app.post('/api/auth/logout', (c) => {
  const token = getCookie(c, 'sentigraph_session');
  if (token) sessions.delete(token);
  deleteCookie(c, 'sentigraph_session');
  return c.json({ success: true });
});

// Dashboard Moderation Actions
app.post('/api/dashboard/feed-mode', async (c) => {
  const userId = getUserIdFromSession(getCookie(c, 'sentigraph_session'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const { mode } = await c.req.json();
  if (mode !== 'latest' && mode !== 'curated') {
    return c.json({ error: 'Invalid feed mode' }, 400);
  }

  queries.updateFeedMode(userId, mode);
  return c.json({ success: true, mode });
});

app.post('/api/dashboard/theme', async (c) => {
  const userId = getUserIdFromSession(getCookie(c, 'sentigraph_session'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const { themeVariant, colorMode } = await c.req.json();
  if (
    !['broadside', 'minimal', 'modern'].includes(themeVariant) ||
    !['dark', 'light'].includes(colorMode)
  ) {
    return c.json({ error: 'Invalid theme or color mode parameter' }, 400);
  }

  queries.updateTheme(userId, themeVariant, colorMode);
  return c.json({ success: true, themeVariant, colorMode });
});

app.post('/api/dashboard/moderate', async (c) => {
  const userId = getUserIdFromSession(getCookie(c, 'sentigraph_session'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const { sentimentId, isHidden } = await c.req.json();
  queries.setHidden(userId, sentimentId, !!isHidden);
  return c.json({ success: true });
});

app.post('/api/dashboard/pin', async (c) => {
  const userId = getUserIdFromSession(getCookie(c, 'sentigraph_session'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const { sentimentId, isPinned, pinOrder } = await c.req.json();
  queries.setPin(userId, sentimentId, !!isPinned, Number(pinOrder) || 0);
  return c.json({ success: true });
});

app.delete('/api/dashboard/sentiment/:id', (c) => {
  const userId = getUserIdFromSession(getCookie(c, 'sentigraph_session'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const sentimentId = c.req.param('id');
  queries.deleteSentiment(userId, sentimentId);
  return c.json({ success: true });
});

// Curator's Console HTML Interface (/dashboard)
app.get('/dashboard', (c) => {
  const token = getCookie(c, 'sentigraph_session');
  const userId = getUserIdFromSession(token);
  const user = userId ? queries.getUserById(userId) : null;

  // Unauthenticated View: Editorial Login / Register Form
  if (!user) {
    const loginHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Curator Console — Sentigraph</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="alternate icon" href="/favicon.ico" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #0A0A0A;
      color: #EDEDED;
      font-family: -apple-system, BlinkMacSystemFont, "Geist Sans", sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .auth-box {
      width: 100%;
      max-width: 440px;
      background: #121212;
      border: 1px solid #262626;
      padding: 36px 32px;
    }
    .masthead {
      border-bottom: 1px solid #262626;
      padding-bottom: 16px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .masthead-logo {
      width: 28px;
      height: 28px;
      flex-shrink: 0;
    }
    .masthead-titles h1 {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #EDEDED;
    }
    .masthead-titles p {
      font-family: "Geist Mono", monospace;
      font-size: 10px;
      color: #737373;
      margin-top: 2px;
    }
    label {
      display: block;
      font-family: "Geist Mono", monospace;
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #737373;
      margin-bottom: 6px;
      margin-top: 16px;
    }
    input {
      width: 100%;
      background: #0A0A0A;
      border: 1px solid #262626;
      color: #EDEDED;
      padding: 10px 12px;
      font-family: "Geist Mono", monospace;
      font-size: 13px;
    }
    input:focus { outline: none; border-color: #555555; }
    .btn-group {
      display: flex;
      gap: 12px;
      margin-top: 24px;
    }
    button {
      flex: 1;
      padding: 12px;
      border: 1px solid #EDEDED;
      font-family: "Geist Mono", monospace;
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      cursor: pointer;
      font-weight: 700;
    }
    .btn-primary { background: #EDEDED; color: #0A0A0A; }
    .btn-primary:hover { background: #FFFFFF; }
    .btn-secondary { background: transparent; color: #EDEDED; border-color: #262626; }
    .btn-secondary:hover { border-color: #555555; }
    .msg { margin-top: 16px; font-family: "Geist Mono", monospace; font-size: 10px; text-align: center; }
  </style>
</head>
<body>
  <div class="auth-box">
    <div class="masthead">
      <svg class="masthead-logo" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="4" fill="#0A0A0A" />
        <rect x="0.5" y="0.5" width="31" height="31" rx="4" stroke="#262626" />
        <g transform="translate(4, 7)">
          <path d="M0 2 C3 0, 8 0, 12 3 L12 14 C8 11, 3 11, 0 13 Z" fill="none" stroke="#EDEDED" stroke-width="1.3" />
          <path d="M12 3 C16 0, 21 0, 24 2 L24 13 C21 11, 16 11, 12 14 Z" fill="none" stroke="#EDEDED" stroke-width="1.3" />
          <path d="M12 1 L12 15" stroke="#EDEDED" stroke-width="1" />
          <path d="M12 0 L14.5 6 L12 11 L9.5 6 Z" fill="#EDEDED" />
        </g>
      </svg>
      <div class="masthead-titles">
        <h1>Curator's Console</h1>
        <p>AUTHENTICATION / BROADSIDE REGISTRY</p>
      </div>
    </div>
    <form id="auth-form" onsubmit="event.preventDefault(); handleAuth('/api/auth/login');">
      <label for="u">Username</label>
      <input type="text" id="u" placeholder="e.g. your_github_handle" autocomplete="username" required />
      <label for="p">Password</label>
      <input type="password" id="p" placeholder="••••••••" autocomplete="current-password" required />

      <div style="display: flex; align-items: center; gap: 8px; margin-top: 14px;">
        <input type="checkbox" id="remember" style="width: auto; cursor: pointer;" checked />
        <label for="remember" style="margin: 0; font-size: 11px; cursor: pointer; text-transform: none; color: #A3A3A3; letter-spacing: 0.5px;">
          Remember this terminal session (30 days)
        </label>
      </div>

      <div class="btn-group">
        <button type="submit" class="btn-primary" id="sign-in-btn">Sign In</button>
        <button type="button" class="btn-secondary" onclick="handleAuth('/api/auth/register')">Register</button>
      </div>
      <div id="msg" class="msg"></div>
    </form>

    <!-- Essential Editorial Cookie Notice -->
    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #1C1C1C; font-family: 'Geist Mono', monospace; font-size: 9px; color: #525252; line-height: 1.5; text-align: center;">
      NOTICE: Sentigraph uses strictly essential HTTP session cookies for authentication. Zero tracking or third-party telemetry. By continuing, you agree to their use.
    </div>
  </div>
  <script>
    async function handleAuth(url) {
      const username = document.getElementById('u').value.trim();
      const password = document.getElementById('p').value;
      const rememberMe = document.getElementById('remember').checked;
      const msg = document.getElementById('msg');
      if (!username || !password) {
        msg.style.color = '#F87171';
        msg.textContent = '✗ Please provide both username and password';
        return;
      }
      msg.style.color = '#737373';
      msg.textContent = 'Transmitting...';
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, rememberMe })
        });
        const data = await res.json();
        if (res.ok) {
          window.location.reload();
        } else {
          msg.style.color = '#F87171';
          msg.textContent = '✗ ' + (data.error || 'Authentication failed');
        }
      } catch (err) {
        msg.style.color = '#F87171';
        msg.textContent = '✗ Connection error';
      }
    }
  </script>
</body>
</html>`;
    return c.html(loginHtml);
  }

  // Authenticated Curator Dashboard
  const allSentiments = queries.getAllSentimentsForUser(user.id);
  const host = c.req.header('host') || '127.0.0.1:8072';
  const proto = c.req.header('x-forwarded-proto') || 'http';
  const baseUrl = `${proto}://${host}`;
  const embedSnippet = `[![Sentigraph](${baseUrl}/api/card/${user.username}?theme=${user.theme_variant}&mode=${user.color_mode}&feed=${user.feed_mode})](${baseUrl}/u/${user.username})`;

  const dashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Curator Console — ${escapeXml(user.username)}</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="alternate icon" href="/favicon.ico" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #0A0A0A;
      color: #EDEDED;
      font-family: -apple-system, BlinkMacSystemFont, "Geist Sans", sans-serif;
      padding: 32px 24px;
      line-height: 1.5;
    }
    .container { max-width: 900px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 1px solid #262626;
      padding-bottom: 20px;
      margin-bottom: 32px;
    }
    .header-brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .header-logo {
      width: 32px;
      height: 32px;
      flex-shrink: 0;
    }
    h1 {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .badge {
      font-family: "Geist Mono", monospace;
      font-size: 11px;
      color: #737373;
    }
    .card-section {
      background: #121212;
      border: 1px solid #262626;
      padding: 24px;
      margin-bottom: 28px;
    }
    .section-title {
      font-family: "Geist Mono", monospace;
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #737373;
      margin-bottom: 16px;
    }
    .snippet-box {
      background: #0A0A0A;
      border: 1px solid #262626;
      padding: 12px;
      font-family: "Geist Mono", monospace;
      font-size: 11px;
      color: #A3A3A3;
      word-break: break-all;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    button.btn-subtle {
      background: #171717;
      border: 1px solid #262626;
      color: #EDEDED;
      font-family: "Geist Mono", monospace;
      font-size: 10px;
      letter-spacing: 1px;
      padding: 6px 12px;
      cursor: pointer;
      text-transform: uppercase;
    }
    button.btn-subtle:hover { border-color: #555555; background: #222; }
    .mode-selector {
      display: flex;
      gap: 12px;
      align-items: center;
      margin-top: 12px;
    }
    .mode-btn {
      padding: 8px 16px;
      background: #171717;
      border: 1px solid #262626;
      color: #737373;
      font-family: "Geist Mono", monospace;
      font-size: 11px;
      cursor: pointer;
    }
    .mode-btn.active {
      background: #EDEDED;
      color: #0A0A0A;
      font-weight: 700;
      border-color: #EDEDED;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      font-size: 13px;
    }
    th {
      font-family: "Geist Mono", monospace;
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      text-align: left;
      color: #737373;
      padding: 10px 12px;
      border-bottom: 1px solid #262626;
    }
    td {
      padding: 14px 12px;
      border-bottom: 1px solid #1C1C1C;
      vertical-align: middle;
    }
    tr.hidden-row { opacity: 0.35; text-decoration: line-through; }
    .quote-cell {
      font-family: "Instrument Serif", Georgia, serif;
      font-style: italic;
      font-size: 16px;
      color: #EDEDED;
      max-width: 320px;
    }
    .meta-cell {
      font-family: "Geist Mono", monospace;
      font-size: 11px;
      color: #737373;
      white-space: nowrap;
    }
    .actions-cell {
      text-align: right;
      white-space: nowrap;
    }
    .card-preview-container {
      margin-top: 16px;
      border: 1px solid #262626;
      background: #000;
      display: inline-block;
    }
    .card-preview-container img {
      display: block;
      max-width: 100%;
      height: auto;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="header-brand">
        <svg class="header-logo" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="4" fill="#0A0A0A" />
          <rect x="0.5" y="0.5" width="31" height="31" rx="4" stroke="#262626" />
          <g transform="translate(4, 7)">
            <path d="M0 2 C3 0, 8 0, 12 3 L12 14 C8 11, 3 11, 0 13 Z" fill="none" stroke="#EDEDED" stroke-width="1.3" />
            <path d="M12 3 C16 0, 21 0, 24 2 L24 13 C21 11, 16 11, 12 14 Z" fill="none" stroke="#EDEDED" stroke-width="1.3" />
            <path d="M12 1 L12 15" stroke="#EDEDED" stroke-width="1" />
            <path d="M12 0 L14.5 6 L12 11 L9.5 6 Z" fill="#EDEDED" />
          </g>
        </svg>
        <div>
          <h1>Curator's Console</h1>
          <div class="badge">CURATOR: @${escapeXml(user.username)}</div>
        </div>
      </div>
      <div>
        <button class="btn-subtle" onclick="logout()">Sign Out</button>
      </div>
    </header>

    <!-- Embed Snippet -->
    <div class="card-section">
      <div class="section-title">GitHub Profile README Markdown Snippet</div>
      <div class="snippet-box">
        <code id="embed-code">${escapeXml(embedSnippet)}</code>
        <button class="btn-subtle" onclick="copySnippet()">Copy</button>
      </div>
    </div>

    <!-- Display Policy & Theme Styling -->
    <div class="card-section">
      <div class="section-title">Broadside Aesthetic & Typographic Variant (3 Minimalist Options)</div>
      <div class="mode-selector">
        <button class="mode-btn ${user.theme_variant === 'broadside' ? 'active' : ''}" onclick="setTheme('broadside', '${user.color_mode}')">
          1. Broadside Editorial (Serif + Hairlines + Crest)
        </button>
        <button class="mode-btn ${user.theme_variant === 'minimal' ? 'active' : ''}" onclick="setTheme('minimal', '${user.color_mode}')">
          2. Pure Minimal (Serif + Pure Whitespace + No Hairlines)
        </button>
        <button class="mode-btn ${user.theme_variant === 'modern' ? 'active' : ''}" onclick="setTheme('modern', '${user.color_mode}')">
          3. Modern Grotesque (Swiss Clean Sans + Hairlines)
        </button>
      </div>

      <div class="section-title" style="margin-top: 24px;">Color Canvas Mode</div>
      <div class="mode-selector">
        <button class="mode-btn ${user.color_mode === 'dark' ? 'active' : ''}" onclick="setTheme('${user.theme_variant}', 'dark')">
          ● Dark Canvas (Pitch Carbon #0A0A0A)
        </button>
        <button class="mode-btn ${user.color_mode === 'light' ? 'active' : ''}" onclick="setTheme('${user.theme_variant}', 'light')">
          ○ Light Canvas (Unbleached Broadsheet #F7F6F2)
        </button>
      </div>

      <div class="section-title" style="margin-top: 24px;">Feed Population Mode</div>
      <div class="mode-selector">
        <button class="mode-btn ${user.feed_mode === 'latest' ? 'active' : ''}" onclick="setFeedMode('latest')">
          Display Mode 1: Chronological (Latest 5 Unhidden)
        </button>
        <button class="mode-btn ${user.feed_mode === 'curated' ? 'active' : ''}" onclick="setFeedMode('curated')">
          Display Mode 2: Handpicked / Curated (Pinned 1–5 Slots)
        </button>
      </div>

      <!-- Dual Previews: Live vs Sample Filled -->
      <div style="margin-top: 32px; display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 24px;">
        <div>
          <div class="section-title">① Current Live Feed Preview (Actual Data)</div>
          <div class="card-preview-container">
            <img id="live-card-img" src="/api/card/${escapeXml(user.username)}?t=${Date.now()}" alt="Live Card preview" />
          </div>
          <p style="font-family: 'Geist Mono', monospace; font-size: 10px; color: #737373; margin-top: 8px;">
            This is what appears on your GitHub profile README right now.
          </p>
        </div>

        <div>
          <div class="section-title">② Inscription Sample Preview (Simulated Inscriptions)</div>
          <div class="card-preview-container">
            <img id="sample-card-img" src="/api/card/${escapeXml(user.username)}?sample=true&t=${Date.now()}" alt="Sample Card preview" />
          </div>
          <p style="font-family: 'Geist Mono', monospace; font-size: 10px; color: #737373; margin-top: 8px;">
            Simulates your selected style populated with 5 peer endorsements.
          </p>
        </div>
      </div>
    </div>

    <!-- Moderation Table -->
    <div class="card-section">
      <div class="section-title">Sentiment Moderation Register (${allSentiments.length} Total)</div>
      <table>
        <thead>
          <tr>
            <th>Sentiment Note</th>
            <th>Author Alias</th>
            <th>Curated Slot</th>
            <th>Date</th>
            <th style="text-align: right;">Disciplinary Action</th>
          </tr>
        </thead>
        <tbody>
          ${
            allSentiments.length === 0
              ? `<tr><td colspan="5" style="text-align: center; color: #525252; padding: 24px; font-family: monospace;">— Inscription log is currently unwritten —</td></tr>`
              : allSentiments
                  .map((s) => {
                    const isHidden = s.is_hidden === 1;
                    const isPinned = s.is_pinned === 1;
                    return `
            <tr class="${isHidden ? 'hidden-row' : ''}">
              <td class="quote-cell">“${escapeXml(s.content)}”</td>
              <td class="meta-cell">@${escapeXml(s.author_alias)}</td>
              <td class="meta-cell">
                <select onchange="updatePin('${s.id}', this.value)" style="background:#0A0A0A; color:#EDEDED; border:1px solid #262626; font-family:monospace; font-size:10px; padding:4px;">
                  <option value="0" ${!isPinned ? 'selected' : ''}>Unpinned</option>
                  <option value="1" ${isPinned && s.pin_order === 1 ? 'selected' : ''}>★ Slot 1</option>
                  <option value="2" ${isPinned && s.pin_order === 2 ? 'selected' : ''}>★ Slot 2</option>
                  <option value="3" ${isPinned && s.pin_order === 3 ? 'selected' : ''}>★ Slot 3</option>
                  <option value="4" ${isPinned && s.pin_order === 4 ? 'selected' : ''}>★ Slot 4</option>
                  <option value="5" ${isPinned && s.pin_order === 5 ? 'selected' : ''}>★ Slot 5</option>
                </select>
              </td>
              <td class="meta-cell">${s.created_at.slice(0, 10)}</td>
              <td class="actions-cell">
                <button class="btn-subtle" onclick="toggleHide('${s.id}', ${!isHidden})">
                  ${isHidden ? 'Restore' : 'Strike / Hide'}
                </button>
              </td>
            </tr>
            `;
                  })
                  .join('')
          }
        </tbody>
      </table>
    </div>
  </div>

  <script>
    function refreshPreview() {
      const live = document.getElementById('live-card-img');
      if (live) live.src = '/api/card/${escapeXml(user.username)}?t=' + Date.now();
      const sample = document.getElementById('sample-card-img');
      if (sample) sample.src = '/api/card/${escapeXml(user.username)}?sample=true&t=' + Date.now();
    }

    async function setTheme(themeVariant, colorMode) {
      await fetch('/api/dashboard/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ themeVariant, colorMode })
      });
      window.location.reload();
    }

    async function setFeedMode(mode) {
      await fetch('/api/dashboard/feed-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode })
      });
      window.location.reload();
    }

    async function toggleHide(sentimentId, isHidden) {
      await fetch('/api/dashboard/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentimentId, isHidden })
      });
      window.location.reload();
    }

    async function updatePin(sentimentId, slot) {
      const order = parseInt(slot, 10);
      const isPinned = order > 0;
      await fetch('/api/dashboard/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentimentId, isPinned, pinOrder: order })
      });
      refreshPreview();
    }

    function copySnippet() {
      const code = document.getElementById('embed-code').innerText;
      navigator.clipboard.writeText(code).then(() => alert('Markdown embed copied to clipboard!'));
    }

    async function logout() {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.reload();
    }
  </script>
</body>
</html>`;

  return c.html(dashboardHtml);
});

// Root landing page redirects to dashboard
app.get('/', (c) => c.redirect('/dashboard'));

const port = Number(process.env.PORT) || 8072;
console.log(`[Sentigraph] Broadside service listening on http://127.0.0.1:${port}`);

serve({
  fetch: app.fetch,
  port
});
