#!/usr/bin/env node
/* Local dev server with API — run: node server.js */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3333;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
};

async function handleApiChat(body) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return { status: 500, body: { error: 'Add GROQ_API_KEY to .env.local' } };
  }
  let messages;
  try {
    const data = JSON.parse(body);
    messages = data.messages;
  } catch {
    return { status: 400, body: { error: 'Invalid JSON' } };
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return { status: 400, body: { error: 'messages required' } };
  }

  const systemPrompt = `You are a helpful assistant for Nobulex, the trust layer for the agent economy. Answer about Nobulex in plain language. Be concise.`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      max_tokens: 1024,
    }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { status: 500, body: { error: 'Groq error', details: text.slice(0, 200) } };
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    return { status: 500, body: { error: data.error?.message || 'No response' } };
  }
  return { status: 200, body: { content } };
}

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '').split('?')[0];
  if (req.method === 'POST' && urlPath === '/api/chat') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const result = await handleApiChat(body);
    res.writeHead(result.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(result.body));
    return;
  }

  if (req.method === 'OPTIONS' && urlPath === '/api/chat') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end();
    return;
  }

  // Serve Nobulex logo for all favicon requests (icon.png = nobulex logo)
  if (urlPath === '/favicon.ico' || urlPath === '/favicon.png' || urlPath === '/icon.png') {
    const iconPath = path.join(__dirname, 'icon.png');
    try {
      const data = await fs.promises.readFile(iconPath);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath.replace(/\?.*$/, '').replace(/^\//, ''));
  filePath = path.resolve(filePath);
  if (!filePath.startsWith(path.resolve(__dirname))) {
    res.writeHead(403);
    res.end();
    return;
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
  } catch {
    const notFoundPath = path.join(__dirname, '404.html');
    try {
      const data = await fs.promises.readFile(notFoundPath);
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  const data = await fs.promises.readFile(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(data);
});

function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env.local');
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    }
  } catch {}
}

loadEnv();
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`\n  Nobulex dev server: http://localhost:${PORT}\n  Also try: http://127.0.0.1:${PORT}\n  Chat API: http://localhost:${PORT}/api/chat\n`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Try: PORT=3000 node server.js\n  Then open http://localhost:3000\n`);
  } else {
    console.error('\n  Server error:', err.message);
  }
  process.exit(1);
});
