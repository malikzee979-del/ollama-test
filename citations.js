// Citation extraction for document-grounded chat (Phase 7.7).
//
// When /api/chat retrieves document chunks from Qdrant to ground a reply,
// the raw hits carry everything a reader needs to trust (or check) the
// answer: which document, which chunk, how strong the match was. This
// module turns those hits into a small, serializable citations list that
// rides back to the browser in a response header (X-Citations), the same
// way compaction rides back in X-Compacted.
//
// Pure and DOM-free so the test suite can exercise it directly; server.js
// is the only consumer.

// Header budget: headers are capped in practice (~16KB in Node), and a
// citation is ~200 chars of snippet plus metadata. 12 citations is well
// past what a reader will scroll through and safely under any cap.
const MAX_CITATIONS = 12;
const SNIPPET_MAX_CHARS = 200;

function citationsFromResults(results) {
  const hits = (Array.isArray(results) ? results : [])
    // Filter the hit objects themselves — not the payloads — so the index
    // used to read hit.score stays aligned with the citation being built.
    .filter((h) => h && h.payload && typeof h.payload.text === 'string' && h.payload.text.trim())
    .slice(0, MAX_CITATIONS);
  return hits.map((hit) => {
    const p = hit.payload;
    const text = p.text.trim();
    return {
      // Document points always carry docName (server.js /api/documents
      // sets it); "(untitled document)" only fires for a hand-indexed or
      // legacy point that somehow matched the document filter.
      docName: typeof p.docName === 'string' && p.docName ? p.docName : '(untitled document)',
      chunk: Number.isInteger(p.chunk) ? p.chunk : null,
      score: typeof hit.score === 'number' ? hit.score : null,
      snippet: text.length > SNIPPET_MAX_CHARS ? `${text.slice(0, SNIPPET_MAX_CHARS)}…` : text,
    };
  });
}

module.exports = { citationsFromResults, MAX_CITATIONS, SNIPPET_MAX_CHARS };
