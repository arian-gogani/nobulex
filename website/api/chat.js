/* Vercel serverless function, AI chat for Nobulex help (Groq = free) */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const apiKey = groqKey || openaiKey;
  const useGroq = !!groqKey;

  if (!apiKey) {
    return res.status(500).json({
      error: 'AI chat not configured. Add GROQ_API_KEY (free at console.groq.com) to Vercel env.',
    });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const systemPrompt = `You are a helpful assistant for Nobulex (nobulex.com), the accountability primitive for AI agents. Every agent action produces a signed, tamper-evident receipt; verification is trustless and offline — anyone can check what an agent did from just the receipt and a public key, without access to the agent, its operator, or its platform.

Key facts about Nobulex:
- Free, open source, MIT licensed: pip install nobulex / npm install @nobulex/core
- Bilateral receipt pattern: an admission receipt (intent + authority) and an outcome receipt (result), linked by a content-derived action_ref hash, Ed25519-signed and hash-chained
- Receipts verify offline with the SDK: receipt.verify() recomputes action_ref and checks the signature — no network, no callback to Nobulex
- The bilateral receipt pattern is normative guidance in OWASP Agentic Skills Top 10 (AST09); Nobulex is the reference implementation of it
- Maps to EU AI Act Article 12 record-keeping (enforcement Dec 2, 2027)
- For developers, enterprises, and regulators

Answer questions about Nobulex in plain language. Be concise and accurate — do not overstate adoption or invent API endpoints. If someone asks about compliance, point them to the EU AI Act guide. If they're non-technical, avoid jargon.`;

  const apiUrl = useGroq ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  const model = useGroq ? (process.env.GROQ_MODEL || 'llama-3.1-8b-instant') : 'gpt-4o-mini';

  const groqBody = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    temperature: 0.7,
    max_tokens: 1024,
    ...(model.includes('gpt-oss') && { reasoning_effort: 'medium' }),
  };

  const openaiBody = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    max_tokens: 512,
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(useGroq ? groqBody : openaiBody),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({
        error: 'AI request failed',
        details: err.slice(0, 200),
      });
    }

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      return res.status(500).json({
        error: 'Groq returned invalid JSON',
        details: responseText.slice(0, 300),
      });
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return res.status(500).json({
        error: 'No content in AI response',
        details: JSON.stringify(data).slice(0, 200),
      });
    }

    return res.status(200).json({ content });
  } catch (err) {
    console.error('Chat API error:', err);
    return res.status(500).json({
      error: err.message || 'AI request failed',
    });
  }
}
