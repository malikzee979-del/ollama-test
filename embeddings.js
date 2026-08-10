// Calls Ollama's embeddings endpoint to turn text into a vector.
//
// Newer Ollama versions expose POST /api/embed (body: { model, input },
// response: { embeddings: [[...]] }). Older versions only have
// POST /api/embeddings (body: { model, prompt }, response: { embedding: [...] }).
// We try the new endpoint first and fall back to the old one on a 404.

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';

async function embed(text) {
  // Preferred: /api/embed
  let r = await fetch(`${OLLAMA_HOST}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });

  if (r.status === 404) {
    // Fallback: older /api/embeddings endpoint.
    r = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`Ollama embeddings request failed (${r.status}): ${body || r.statusText}`);
    }
    const data = await r.json();
    if (!Array.isArray(data.embedding)) {
      throw new Error('Unexpected response shape from /api/embeddings.');
    }
    return data.embedding;
  }

  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Ollama embed request failed (${r.status}): ${body || r.statusText}`);
  }

  const data = await r.json();
  // /api/embed returns { embeddings: [[...]] } — one vector per input.
  if (Array.isArray(data.embeddings) && Array.isArray(data.embeddings[0])) {
    return data.embeddings[0];
  }
  if (Array.isArray(data.embedding)) {
    return data.embedding;
  }
  throw new Error('Unexpected response shape from /api/embed.');
}

module.exports = { embed, EMBEDDING_MODEL, OLLAMA_HOST };
