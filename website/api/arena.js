/* Vercel serverless — Nobulex Arena AI agent proxy */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'No API key configured' });

  const useGroq = !!process.env.GROQ_API_KEY;
  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  const { system, messages } = body;
  if (!system || !Array.isArray(messages)) return res.status(400).json({ error: 'system + messages required' });

  const apiUrl = useGroq ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const model = useGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        temperature: 0.8,
        max_tokens: 400,
      }),
    });
    if (!response.ok) { const e = await response.text(); return res.status(response.status).json({ error: e.slice(0, 200) }); }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return res.status(500).json({ error: 'No content in response' });
    return res.status(200).json({ content });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Request failed' });
  }
}
