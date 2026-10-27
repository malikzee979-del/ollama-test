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

let client = new QdrantClient({ url: QDRANT_URL });

// Test-only hook: lets test/qdrant.test.js swap in a fake client that
// implements collectionExists/createCollection/upsert/search/getCollection,
// without adding a mocking dependency. Mirrors the injected-dependency
// pattern used elsewhere in this project (e.g. compaction.js's `summarize`).
function _setClientForTests(fakeClient) {
  client = fakeClient || new QdrantClient({ url: QDRANT_URL });
  collectionReady = false;
}

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
  } else {
    const info = await client.getCollection(QDRANT_COLLECTION);
    const existingSize = info && info.config && info.config.params && info.config.params.vectors
      && info.config.params.vectors.size;
    if (existingSize && existingSize !== EMBEDDING_DIM) {
      throw new Error(
        `Qdrant collection "${QDRANT_COLLECTION}" was created with vector size ${existingSize}, `
        + `but EMBEDDING_DIM is currently set to ${EMBEDDING_DIM}. This usually means EMBEDDING_DIM `
        + `was changed after the collection already existed. Either set EMBEDDING_DIM=${existingSize} `
        + `to match the existing collection, or delete/recreate the "${QDRANT_COLLECTION}" collection `
        + `in Qdrant so it can be rebuilt with the new dimension.`
      );
    }
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

// Runs `fn` (which assumes the collection exists) and, if it fails, resets
// collectionReady, re-runs ensureCollection() (which will recreate the
// collection if it was deleted externally), and retries `fn` exactly once.
// If the retry also fails, the retry's error propagates so callers still see
// a real failure (turned into a 503 upstream) instead of a silently masked
// one.
async function withCollectionRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    collectionReady = false;
    await ensureCollection();
    return fn();
  }
}

// Upserts a single point { id, vector, payload }.
async function upsertPoint({ id, vector, payload }) {
  await ensureCollection();
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIM) {
    const gotLen = Array.isArray(vector) ? vector.length : typeof vector;
    throw new Error(
      `Embedding has dimension ${gotLen}, but this Qdrant collection expects EMBEDDING_DIM=${EMBEDDING_DIM}. `
      + `This usually means EMBEDDING_MODEL was changed to a model that produces different-sized vectors. `
      + `Align EMBEDDING_MODEL/EMBEDDING_DIM, or recreate the "${QDRANT_COLLECTION}" collection for the new size.`
    );
  }
  await withCollectionRetry(() => client.upsert(QDRANT_COLLECTION, {
    wait: true,
    points: [{ id, vector, payload }],
  }));
}

// Searches by vector, returning [{ id, score, payload }, ...]. Pass
// `filter` to scope results (e.g. to a single user's payload.userId), so
// one account's semantic memory search never surfaces another account's
// indexed messages.
async function searchByVector(vector, { limit = 5, scoreThreshold, filter } = {}) {
  await ensureCollection();
  const results = await withCollectionRetry(() => client.search(QDRANT_COLLECTION, {
    vector,
    limit,
    filter,
    with_payload: true,
    score_threshold: scoreThreshold,
  }));
  return results.map((r) => ({ id: r.id, score: r.score, payload: r.payload }));
}

// Lists a page of this user's stored memory points (7.8 memory editing).
// Scrolls by payload filter (userId) rather than by vector — no embedding
// call needed to *see* what's stored. Returns [{ id, payload }, ...] plus
// `nextOffset` for pagination (null/undefined when exhausted).
async function listPoints({ userId, limit = 50, offset } = {}) {
  await ensureCollection();
  const res = await withCollectionRetry(() => client.scroll(QDRANT_COLLECTION, {
    limit,
    offset,
    with_payload: true,
    filter: { must: [{ key: 'userId', match: { value: userId } }] },
  }));
  return {
    points: (res.points || []).map((p) => ({ id: p.id, payload: p.payload })),
    nextOffset: res.next_page_offset ?? null,
  };
}

// Deletes one point by id, scoped to the owning user via a payload filter —
// a caller can therefore never delete another account's memory point even
// with a guessed id (Qdrant only deletes points matching BOTH filters).
async function deletePoint({ id, userId }) {
  await ensureCollection();
  await withCollectionRetry(() => client.delete(QDRANT_COLLECTION, {
    wait: true,
    points: [{ id }],
    filter: { must: [{ key: 'userId', match: { value: userId } }] },
  }));
}

// Replaces a point's text payload by re-embedding the new text and
// upserting at the same id with the original metadata (7.8). Scoped like
// deletePoint: the read must match the user's filter first.
async function updatePointText({ id, userId, text, embed }) {
  await ensureCollection();
  const res = await withCollectionRetry(() => client.retrieve(QDRANT_COLLECTION, {
    ids: [id],
    with_payload: true,
  }));
  const existing = (res && res[0]) || null;
  if (!existing || !existing.payload || existing.payload.userId !== userId) {
    return null; // not found, or belongs to another user
  }
  // Keep everything except the text being replaced — spread the rest
  // through so kind/role/docName etc. survive the edit. (userId is
  // re-set explicitly below.)
  const metadata = { ...existing.payload };
  delete metadata.text;
  const vector = await embed(text);
  await withCollectionRetry(() => client.upsert(QDRANT_COLLECTION, {
    wait: true,
    points: [{ id, vector, payload: { ...metadata, userId, text } }],
  }));
  return { id, payload: { ...metadata, userId, text } };
}

module.exports = {
  QDRANT_URL,
  QDRANT_COLLECTION,
  EMBEDDING_DIM,
  checkConnection,
  upsertPoint,
  searchByVector,
  listPoints,
  deletePoint,
  updatePointText,
  ensureCollection,
  _setClientForTests,
};
