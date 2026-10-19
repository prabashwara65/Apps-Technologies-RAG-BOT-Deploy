# Office Intelligence Automation Platform

## Overview

The Office Intelligence Automation Platform (OIAP) is an AI engineering project
for controlled internal knowledge retrieval. It is built around one principle:
an assistant should answer only from approved source documents, and should show
which ones it used.

The system is a **document-grounded RAG (retrieval-augmented generation)
service**. It answers questions strictly from an approved, versioned document
set, returns validated citations for supported answers, and says so plainly
when the available sources do not support an answer.

There are three flows:

- **Authentication** — users sign up and log in; sessions are cookie-based.
- **Ingestion** — documents are uploaded and stored so they can be retrieved.
- **Query** — a question is retrieved against, answered from, and cited back to
  the stored documents.

All three share one data layer (PostgreSQL with pgvector) and one model
provider (the Gemini APIs).

The longer-term goal is governed office automation: document ingestion with
human approval, workflow orchestration, and assistive automation that keeps a
person in the decision loop rather than acting autonomously.

---

## Current Status

**A working document-grounded RAG service, run locally.** Documents are
uploaded and ingested, and the assistant answers questions against them using
hybrid retrieval and validated citations.

There is no deployed demo and no public endpoint. The system runs locally.

---

## Current Milestone

**Hybrid retrieval with grounded, cited answers.**

Retrieval is **hybrid**: a dense vector branch over pgvector and a sparse
full-text branch over PostgreSQL `tsvector`, fused with Reciprocal Rank Fusion.
The two branches receive *different* query strings — the original user question
for the sparse branch (preserving exact keywords), and an LLM-expanded query
for the dense branch (improving semantic reach for short questions).

The grounded answer flow behind it:

1. **Query expansion (Gemini)** — the user question is expanded into a fuller
   semantic query.
2. **Dual retrieval**
   - *Vector* — embed the expanded query (Gemini), search pgvector by cosine
     distance, take the top 50 chunks.
   - *BM25* — `plainto_tsquery` on the **original** question, rank with
     `ts_rank_cd`, take the top 50 chunks.
3. **Reciprocal Rank Fusion** — `RRF score = Σ 1/(k + rank)`, with `k = 10`,
   producing the top 5 chunks.
4. **Context builder** — chunks are labelled `[S1]`, `[S2]`, … and bounded to
   6000 characters.
5. **Grounded answer (Gemini)** — the system prompt instructs the model to
   answer **only** from the supplied context.
6. **Citation validation** — every `[S#]` in the answer must exist in the
   supplied sources.

The pipeline returns either an **answer with citations** or
**"insufficient evidence"**.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                 │
│                     (browser / local UI)                            │
└───────────────┬─────────────────────────────────┬───────────────────┘
                │                                 │
        signup / login                      authenticated requests
                │                                 │
                ▼                                 ▼
┌───────────────────────────────┐   ┌─────────────────────────────────┐
│      AUTH (cookie-based)      │   │   DOCUMENT UPLOADER +           │
│  ───────────────────────────  │   │   QUERY PIPELINE                │
│  • signup (email + password)  │   │  ─────────────────────────────  │
│  • login (email + password)   │   │  • document uploader            │
│  • session cookie             │   │  • query pipeline               │
└───────────────┬───────────────┘   └────────────────┬────────────────┘
                │                                    │
                ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           DATA LAYER                                │
│  ────────────────────────────────────────────────────────────────   │
│  PostgreSQL + pgvector                                              │
│    • users / sessions                                               │
│    • document chunks                                                │
│    • embeddings          (dense / vector branch)                    │
│    • tsvector            (sparse / full-text branch)               │
└─────────────────────────────────────────────────────────────────────┘
                │                                    │
                └────────────────┬───────────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │      GEMINI APIs        │
                    │  • query expansion      │
                    │  • embeddings           │
                    │  • grounded generation  │
                    └─────────────────────────┘
```

The client authenticates first, then reaches the uploader and query pipeline.
Both write to and read from the shared data layer, and both depend on the
Gemini APIs.

---

## Authentication

The system uses **cookie-based sessions**:

- **Signup** — email and password.
- **Login** — email and password.
- **Session** — issued as a cookie and validated on subsequent requests.

Unauthenticated requests do not reach the uploader or the query pipeline.

<!-- TODO: confirm session storage (DB-backed vs signed cookie) and expiry -->

---

## Ingestion Pipeline

Documents are uploaded and prepared for retrieval.

```
Upload document
      │
      ▼
┌───────────────────┐
│  Accept document  │
└─────────┬─────────┘
          ▼
┌───────────────────┐
│  Parse / extract  │
│  text             │
└─────────┬─────────┘
          ▼
┌───────────────────┐
│  Chunk            │
└─────────┬─────────┘
          ▼
┌───────────────────┐
│  Embed (Gemini)   │
└─────────┬─────────┘
          ▼
┌───────────────────┐
│  Store in         │
│  PostgreSQL +     │
│  pgvector         │
└───────────────────┘
```

Each stored chunk carries:

- its **text**,
- its **embedding** (for the dense branch),
- its **`tsvector`** (for the sparse branch),
- and a reference back to the source document.

The uploader is what makes the rest of the system work: without ingested
documents, retrieval has nothing to search.

---

## Query Pipeline

A question flows through six stages. The diagram below is the canonical view of
the grounded answer flow.

```
User types a question
        │
        ▼
┌──────────────────────────────────────────────────────────┐
│  1. QUERY EXPANSION (Gemini)                             │
│     "What line spacing is required?"                     │
│       → "What are the standard line spacing requirements │
│          for professional documents or academic papers?" │
└──────────────────────┬───────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
┌──────────────────┐         ┌──────────────────┐
│  2a. VECTOR      │         │  2b. BM25        │
│  Embed expanded  │         │  plainto_tsquery │
│  query (Gemini)  │         │  on ORIGINAL     │
│       ↓          │         │       ↓          │
│  pgvector cosine │         │  ts_rank_cd      │
│  distance search │         │  ranking         │
│       ↓          │         │       ↓          │
│  Top 50 chunks   │         │  Top 50 chunks   │
└────────┬─────────┘         └────────┬─────────┘
         │                            │
         └──────────────┬─────────────┘
                        ▼
        ┌───────────────────────────────┐
        │  3. RECIPROCAL RANK FUSION    │
        │     RRF score = Σ 1/(k + rank)│
        │     k = 10                    │
        │     → Top 5 chunks            │
        └───────────────┬───────────────┘
                        ▼
        ┌───────────────────────────────┐
        │  4. CONTEXT BUILDER           │
        │     [S1] doc1 chunk text      │
        │     [S2] doc2 chunk text      │
        │     (bounded to 6000 chars)   │
        └───────────────┬───────────────┘
                        ▼
        ┌───────────────────────────────┐
        │  5. GROUNDED ANSWER (Gemini)  │
        │     System prompt: answer     │
        │     ONLY from context         │
        └───────────────┬───────────────┘
                        ▼
        ┌───────────────────────────────┐
        │  6. CITATION VALIDATION       │
        │     Every [S#] must exist     │
        │     in the supplied sources   │
        └───────────────┬───────────────┘
                        ▼
        Answer + citations OR "insufficient evidence"
```

### Stage 1 — Query Expansion

The user's question is passed to Gemini and expanded into a fuller semantic
query. Short or ambiguous questions ("What line spacing is required?") become
explicit ones ("What are the standard line spacing requirements for
professional documents or academic papers?").

This expanded query is used **only** by the dense branch. The original question
is preserved for the sparse branch.

### Stage 2 — Dual Retrieval

Two independent retrievals run in parallel:

- **2a. Vector (dense).** The expanded query is embedded with Gemini. pgvector
  performs a cosine-distance search over stored chunk embeddings. The top 50
  chunks are returned.
- **2b. BM25 (sparse).** The **original** question is converted with
  `plainto_tsquery` and matched against the stored `tsvector` column, ranked by
  `ts_rank_cd`. The top 50 chunks are returned.

The two branches deliberately receive **different query strings**:

- The sparse branch keeps the original wording, preserving exact keywords.
- The dense branch uses the expanded query, improving semantic reach for short
  questions.

### Stage 3 — Reciprocal Rank Fusion

The two ranked lists are fused with Reciprocal Rank Fusion:

```
RRF score = Σ 1 / (k + rank)
```

with `k = 10`. RRF combines the lists by **rank**, not by raw score, which
avoids having to normalise cosine distance and `ts_rank_cd` against each other.
Fusion produces the **top 5 chunks**.

### Stage 4 — Context Builder

The top 5 chunks are assembled into a context block, each labelled with a
source marker:

```
[S1] doc1 chunk text
[S2] doc2 chunk text
...
```

The block is bounded to **6000 characters** to keep the generation step within
limits.

### Stage 5 — Grounded Answer

The context block and the question are sent to Gemini with a system prompt that
instructs the model to answer **only** from the supplied context. The model is
expected to cite sources using the `[S#]` markers.

### Stage 6 — Citation Validation

Every `[S#]` in the generated answer must correspond to a source that was
actually supplied in the context. Any citation that does not exist in the
supplied sources invalidates the answer.

The pipeline returns either:

- an **answer with citations**, or
- **"insufficient evidence"** when the sources do not support an answer.

---

## Data Layer

All state lives in **PostgreSQL with pgvector**:

| Store | Purpose | Used by |
| --- | --- | --- |
| Users / sessions | Accounts and cookie sessions | Auth |
| Document chunks | Chunk text and source references | Both branches |
| Embeddings | Dense vectors per chunk | Vector branch (2a) |
| `tsvector` | Full-text index per chunk | BM25 branch (2b) |

Keeping both indexes in one database means the two retrieval branches read from
the same source of truth, and fusion needs no cross-system reconciliation.

---

## Model Provider — Gemini APIs

Gemini is used in three places:

| Use | Pipeline | Purpose |
| --- | --- | --- |
| Query expansion | Query | Broaden the dense query |
| Embeddings | Ingestion + Query | Vectorise chunks and queries |
| Grounded generation | Query | Produce the cited answer |

---

## Design Rationale

- **Two query strings, one fusion.** The sparse branch keeps the original
  question (exact keywords); the dense branch uses the expanded query (semantic
  reach). Fusing ranked lists — rather than merging scores — keeps the two
  branches independent and avoids score normalisation.
- **Hybrid retrieval.** Dense search handles paraphrase and meaning; BM25
  handles exact terms, names, and numbers. Neither alone covers both.
- **RRF over score blending.** Reciprocal Rank Fusion is robust to the
  incomparable scales of cosine distance and `ts_rank_cd`, and needs only a
  single constant (`k = 10`).
- **Grounded by construction.** The system prompt restricts generation to the
  supplied context, and citation validation rejects any `[S#]` not present in
  that context. Unsupported answers degrade to "insufficient evidence" rather
  than being invented.
- **Bounded context.** The context builder caps at 6000 characters to keep the
  generation step predictable.

---

## Current Limitations
- **Document ingestion has no human approval step yet.**

---

## Roadmap

- Human approval on document ingestion.
- Role-based authorisation.
- Workflow orchestration and assistive automation.

## Longer-Term Goal

Governed office automation: document ingestion with human approval, workflow
orchestration, and assistive automation that keeps a person in the decision
loop rather than acting autonomously.
