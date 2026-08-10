// Thin wrapper around the Qdrant REST client for semantic memory storage.
//
// Qdrant here stores VECTORS + metadata payloads for similarity search only —
// it is not the primary chat-history store (that's a separate track). This
// module is intentionally self-contained so it can fail without taking down
// the rest of the server: every exported function may reject, and callers
// are expected to catch and turn that into a 503.

const { QdrantClient } = require('@qdrant/js-client-rest');

const QDRANT_URL = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'chat_messages';
const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM) || 768;

const client = new QdrantClient({ url: QDRANT_URL });

// Tracks whether we've already ensured the collection exists this process,
// so we don't re-check it on every request.
let collectionReady = false;

async function ensureCollection() {
  if (collectionReady) return;
  const { exists } = await client.collectionExists(QDRANT_COLLECTION);
  if (!exists) {
    await client.createCollection(QDRANT_COLLECTION, {
      vectors: { size: EMBEDDING_DIM, distance: 'Cosine' },
    });
  }
  collectionReady = true;
}

// One-time, non-fatal startup check. Logs a single warning if Qdrant isn't
// reachable but never throws — the caller (server.js) should not await
// anything blocking on this.
async function checkConnection() {
  try {
    await client.getCollections();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Upserts a single point { id, vector, payload }.
async function upsertPoint({ id, vector, payload }) {
  await ensureCollection();
  await client.upsert(QDRANT_COLLECTION, {
    wait: true,
    points: [{ id, vector, payload }],
  });
}

// Searches by vector, returning [{ id, score, payload }, ...].
async function searchByVector(vector, { limit = 5, scoreThreshold } = {}) {
  await ensureCollection();
  const results = await client.search(QDRANT_COLLECTION, {
    vector,
    limit,
    with_payload: true,
    score_threshold: scoreThreshold,
  });
  return results.map((r) => ({ id: r.id, score: r.score, payload: r.payload }));
}

module.exports = {
  QDRANT_URL,
  QDRANT_COLLECTION,
  EMBEDDING_DIM,
  checkConnection,
  upsertPoint,
  searchByVector,
};
