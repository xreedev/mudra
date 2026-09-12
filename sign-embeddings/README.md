# MUDRA+ · Custom sign via embedding

Lets a user teach the app a new sign at runtime, without retraining or
redeploying the trained classifier (`sign_asl.tflite`). See `INTEGRATION.md`
for the full design writeup and how this plugs into the main app.

## Why this exists

`sign_asl.tflite`'s output layer is hard-wired to the fixed vocabulary it
was trained on (per `TRAINING.md`). Adding a real new class means
retraining and shipping a new model file. This module instead reuses an
*internal* layer of that same trained model as a general-purpose feature
extractor (`sign_embed.tflite`, built once via `ml/export_embedding_model.py`),
and matches new signs against user-stored prototype vectors via cosine
similarity — no retraining required, ever, for this to work.

## What's here

- `src/` — the portable matching/storage logic (this is what gets copied
  into `app/src/features/signing/`). Zero React Native or TFLite
  dependency — pure TypeScript, fully unit-tested.
- `ml/export_embedding_model.py` — one-time script to produce
  `sign_embed.tflite` from your already-trained model.
- `__tests__/` — proves the matching/priority/collision logic against
  synthetic embedding vectors (no camera or real model needed to verify
  this layer is correct).

## Run the tests

```bash
npm install
npm test
```

## Design decisions (see INTEGRATION.md for the full reasoning)

- **Enrollment captures a short video/landmark-window, not a snapshot** —
  the model is a sequence model; most signs are defined by motion, and a
  single frame can't reproduce what the embedding extractor was trained to
  see.
- **The base classifier is checked first; the custom matcher only gets a
  say when the base classifier is unsure** — prevents a well-recognized
  known sign from being hijacked by a similar-looking custom prototype.
- **Enrollment-time collision warnings** — a new prototype too close to an
  existing one (custom or base) is flagged to the user immediately, rather
  than causing silent runtime ambiguity later.
- **Stored per-user, per-device, no backend** — consistent with this
  project's on-device-first design for both signing and the LLM layer.
