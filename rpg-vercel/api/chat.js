export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  // 7 Gemini API keys — rodízio automático para evitar rate limit
  const API_KEYS = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
    process.env.GEMINI_API_KEY_6,
    process.env.GEMINI_API_KEY_7,
  ].filter(Boolean);

  if (API_KEYS.length === 0) {
    return res.status(500).json({ error: 'Nenhuma GEMINI_API_KEY configurada no servidor.' });
  }

  const { system, messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Campo "messages" ausente ou inválido.' });
  }

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const body = {
    contents,
    generationConfig: { maxOutputTokens: 1024, temperature: 0.9 }
  };

  if (system) {
    body.system_instruction = { parts: [{ text: system }] };
  }

  // Tenta cada chave em ordem aleatória (distribui carga)
  const shuffled = [...API_KEYS].sort(() => Math.random() - 0.5);

  let lastError = null;
  for (const apiKey of shuffled) {
    try {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      );

      const data = await geminiRes.json();

      if (geminiRes.status === 429 || geminiRes.status === 503) {
        // Rate limit nessa chave, tenta a próxima
        lastError = data?.error?.message || `HTTP ${geminiRes.status}`;
        continue;
      }

      if (!geminiRes.ok) {
        console.error('Gemini API error:', data);
        return res.status(geminiRes.status).json({
          error: data?.error?.message || 'Erro na API Gemini'
        });
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        return res.status(500).json({ error: 'Resposta vazia da API Gemini.' });
      }

      return res.status(200).json({ text });

    } catch (err) {
      lastError = err.message;
      console.error('Erro ao chamar Gemini com chave:', err);
    }
  }

  // Todas as chaves falharam
  console.error('Todas as chaves Gemini falharam. Último erro:', lastError);
  return res.status(429).json({ error: 'Todas as chaves API estão com rate limit. Tente em instantes.' });
}
