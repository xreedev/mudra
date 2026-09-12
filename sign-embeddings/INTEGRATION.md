# Custom sign via embedding — integration notes

For whoever wires this into the main app's sign-recognition pipeline
(`PLAN.md` §1, `features/signing/`). This assumes you've read `PLAN.md`,
`TRAINING.md`, and this feature's own `README.md`.

## The problem this solves

`TRAINING.md` is explicit that the trained classifier's output layer is
hard-wired to its fixed vocabulary — adding a real new sign normally means
recollecting data, retraining, and shipping a new `sign_asl.tflite`. This
module lets a user teach the app a new sign **on-device, instantly, without
touching the trained model at all**.

## The approach: transfer learning, not retraining

Reuse an internal layer of the *existing* trained classifier as a
general-purpose feature extractor. That layer already learned to produce
rich, discriminative features to do classification — those features are
useful for recognizing signs it never saw, the same trick face-recognition
apps use to enroll a new person without retraining their face model.

```
enrollment:  landmarks (window) → sign_embed.tflite → embedding vector
             (repeat 3–5x, average into one "prototype", save it locally)

runtime:     landmarks (window) → sign_embed.tflite → live embedding vector
             → cosine-similarity search against stored prototypes
```

## Step 1 — produce `sign_embed.tflite` (one-time, do this first)

Run `ml/export_embedding_model.py` against the **original** trained model
file (Keras `.h5`/`.keras`, not the already-exported `.tflite`):

```bash
python export_embedding_model.py --model sign_asl.keras --list-layers
# pick a layer — usually -2 (just before the final softmax Dense)
python export_embedding_model.py --model sign_asl.keras --layer -2 --out sign_embed.tflite
```

If only the exported `.tflite` is available (original training artifacts
lost), see the Case B note at the bottom of that script — it's a real but
more fragile path (TFLite tensor introspection instead of a clean Keras
layer slice). Strongly prefer having the original model file if at all
possible.

**Sanity check before trusting it:** run the same landmark window through
both `sign_asl.tflite` and the new `sign_embed.tflite`. The embedding
should be a stable, non-degenerate vector — different signs should produce
visibly different vectors (check pairwise cosine similarity across a few
known signs by hand before building any UI on top of this).

## Step 2 — wire the native pieces (not built in this package)

This package is pure logic — no camera, no TFLite runtime, no file I/O
implementation. Two things need building in the RN app itself:

1. **Load `sign_embed.tflite`** the same way `sign_asl.tflite` is already
   loaded (`react-native-fast-tflite`, per `PLAN.md`'s tech stack table).
   Run it on the exact same landmark window the classifier already
   receives — **train/serve parity matters here exactly as much as it does
   for the main classifier** (same landmark order, same normalization,
   same window length — see `TRAINING.md` §6).
2. **Implement `FileIO`** (see `src/prototypeStore.ts`) with real
   `react-native-fs` calls, then construct a `FileBackedPrototypeStore`
   pointed at a path under the app's own storage — the exact same
   `RNFS.mkdir`-by-the-app-not-by-adb pattern documented in the LLM
   testbed's own `INTEGRATION.md` applies here too if you ever debug this
   over adb.

Everything else — `cosineSimilarity`, `averageVectors`, `buildPrototype`,
`findBestMatch`, `decideRecognition`, `checkEnrollmentCollision` — is
copy-paste ready from `src/`.

## Step 3 — the enrollment flow (UI, not built here)

1. User names the new sign (or types the phrase it should produce).
2. Camera runs exactly like live recognition already does. When the
   landmark buffer fills one window (same trigger `useSignRecognition.ts`
   already uses), feed it to `sign_embed.tflite` instead of the base
   classifier.
3. Repeat 3–5 times.
4. **Before saving**, call `checkEnrollmentCollision()` against existing
   custom prototypes and (optionally) one reference embedding per
   base-vocabulary sign. If it flags something, warn the user
   ("this looks a lot like your sign for X — try to make yours more
   distinct") rather than silently saving an ambiguous sign.
5. `buildPrototype()` the samples into one vector, save via the
   `PrototypeStore`.

## Step 4 — the runtime decision (in `useSignRecognition.ts`)

```ts
const result = decideRecognition(
  baseClassifierResult,      // { label, confidence } from sign_asl.tflite
  liveEmbeddingVector,       // from sign_embed.tflite, same window
  await prototypeStore.list(),
  {
    baseConfidenceThreshold: /* same THRESHOLD already tuned per TRAINING.md §9 */,
    custom: { threshold: 0.75, minMargin: 0.05 }, // tune against real device data
  },
);
```

**Why base-confidence-first, not custom-first:** if the custom matcher were
checked unconditionally on every window, a normal, correct performance of
an *existing* base sign could accidentally match a custom prototype that
looks similar, hijacking a sign the base classifier would have gotten
right. Checking the base classifier's own confidence first means the
custom matcher only gets a say when the base model is already unsure —
i.e., when the gesture likely isn't one of its known classes at all. This
is the same idea as out-of-distribution detection.

`result.kind` is one of:
- `'base'` — trust the classifier's own label as normal.
- `'custom'` — emit `result.prototype.label` as the recognized gloss/text.
- `'unknown'` — same handling as low-confidence/IDLE in the base pipeline
  today: emit nothing, let the user re-sign. Never guess.

Every emitted result — base, custom, or eventually-confirmed-unknown —
still flows through the existing confirmation gate before anything is
spoken. Recognition quality doesn't need to be perfect; it needs to never
block the user from correcting it.

## What was deliberately NOT built

- **Folding popular custom signs back into the base classifier.** Discussed
  and intentionally deferred — a real but occasional maintenance workflow
  (collect several users' prototypes for the same intended word → real
  `TRAINING.md`-style retrain → ship an app update), not something to
  automate per-sign. Worth remembering if vocabulary growth becomes a
  priority later.
- **Cross-device/account sync of custom signs.** Local-only for now,
  consistent with this project's on-device-first design elsewhere.
- **A dedicated triplet/contrastive-loss embedding model.** This design
  uses transfer learning from the existing classifier (Step 1) as the
  pragmatic v1. If custom-sign matching quality turns out too weak on real
  device data, training a proper metric-learning model on the same
  landmark clips already being collected is the natural upgrade — same
  data, different loss function, not a new data-collection effort.
