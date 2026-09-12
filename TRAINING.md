# MUDRA+ — ASL Model Training Plan

Companion to `PLAN.md`. This document covers **only** the one piece that requires a training run: the on-device sign classifier (`assets/models/sign_asl.tflite`) that maps a window of MediaPipe landmarks → an ASL gloss token. Everything else in MUDRA+ is off-the-shelf.

## 0. Objective & scope

Train a **small TFLite classifier** that recognizes a **tight, custom gloss set** (the ~15 signs needed to drive the pharmacy and emergency demo flows) reliably under stage conditions.

- **This is Tier 3** from `PLAN.md §1a` — a custom-recorded set tuned to our signer, *not* WLASL-2000 and *not* fingerspelling-per-letter.
- **Why small wins:** the demo's impact is `glosses → LLM → fluent sentence → confirm → call`. The classifier only has to emit a few reliable tokens; the LLM does the language. A 15-class model tuned to us beats a 2000-class model that stumbles live.
- **Success = reliability, not vocabulary size.** Target: **≥90% per-sign accuracy** on a held-out set of our own signing, **zero emergency false-triggers** past the confidence threshold, and **sign→gloss latency <1s** on the iQOO (the `PLAN.md` budget).

## 1. Base repo — fork SignLens

Fork **`SiD-array/SignLens-RealTime-ASL-Recognition`** (MIT). It already implements our `ml/` pipeline:

| SignLens file | Role | Maps to our `ml/` |
|---|---|---|
| `extract_landmarks.py` | video clips → `(30,126)` `.npy` sequences | `extract_landmarks.py` |
| `train_lstm.py` | trains LSTM → `lstm_model.keras` | `train_classifier.py` |
| `labels.json` | class list (edit to add signs, no code change) | `phrases.json` |
| `main.py` | live webcam inference (desktop sanity check) | — (RN app replaces this) |

**What we change:** replace their labels + data with our custom gloss set, add a **TFLite export step** (SignLens stops at `.keras`), and lock preprocessing to match the React Native side exactly (§6, the critical part).

> **We do NOT reuse SignLens's shipped `lstm_model.keras`.** A classifier's output layer is hard-wired to the exact classes it was trained on (their demo labels / WLASL words), so it physically cannot emit our tokens (`METFORMIN`, `AMBULANCE`, …). We reuse the **MIT-licensed pipeline code** and retrain from scratch on our own data. The checkpoint is just their demo artifact.

### Which repo for what

We looked at several ASL repos. Ranked by usefulness to MUDRA+:

| Repo | License | Use it for | Don't expect |
|---|---|---|---|
| **SiD-array/SignLens** | MIT | **Fork it.** The pipeline we actually run: `extract_landmarks → train_lstm`, `labels.json` dynamic classes, sliding-window inference. | Its trained `.keras` (wrong classes) |
| **DEV-D-GR8/SignSense** | MIT | **Read it.** Reference for the two things SignLens lacks: the **`.keras`→TFLite export** step, and the **gloss→sentence LLM prompt** pattern (it uses Gemini exactly like our `glossToText`). Also proves our whole architecture (MediaPipe → transformer → LLM) works. | Any code drop-in — it's a **desktop OpenCV app**, not RN/mobile; and its model is trained on the 250 PopSign words, not our vocabulary |
| VectorNd/Isolated-Sign-Language-Recognition | none | Architecture reference for the Kaggle asl-signs Transformer→TFLite approach | Copying code (no license); no shipped weights |
| TheRollerBlader/SignBridge | verify | Reference for the **Tier-1 fingerspelling A–Z fallback** | License wasn't declared — check before reusing code |

**Net:** fork **SignLens** for the training pipeline, crib the **TFLite export + LLM-prompt** shape from **SignSense**, and train on our own signs.

### The 250-word dataset & a pretrained shortcut

The Kaggle **asl-signs** dataset (which SignSense and VectorNd both use) is **250 PopSign words** — toddler/parent everyday vocabulary (animals, food, feelings, colors, basic actions). Overlap with our gloss set is thin: usable ones are roughly `HELLO`, `YES`, `NO`, `THANKYOU`, `PLEASE`, `sick`, and `owie` (childish "hurt" → our `PAIN`). **None** of our demo-critical tokens (`METFORMIN`, `STRIP`, `AMBULANCE`, `EMERGENCY`, `DEAF`, `MEDICINE`) are in it.

Two consequences for the "no data" problem:
- An **MIT-licensed pretrained `model.tflite` (1st-place solution, ~11 MB)** exists on Hugging Face (`sign/kaggle-asl-signs-1st-place`) for those 250 signs — a **zero-data, zero-training** drop-in *if* a sign is in the set. Locked to the 250 words.
- So the realistic split is: lean on dataset/pretrained coverage for the few generic signs, and **self-record only the 3–5 demo-critical medical/emergency signs** (or fingerspell them via the Tier-1 fallback). That's the hybrid that shrinks recording from ~15 signs to a handful.

## 2. The gloss vocabulary

Keep it to what the two scripted flows need, plus a mandatory idle/negative class. Emergency-critical signs get **extra samples** and a **higher confidence bar**.

| Gloss token | Category | Notes |
|---|---|---|
| `HELLO` | greeting | flow opener |
| `NEED` | general | core of pharmacy phrase |
| `MEDICINE` | pharmacy | |
| `ONE` | pharmacy | quantity |
| `STRIP` | pharmacy | quantity unit |
| `METFORMIN` | pharmacy | **demo-specific token** — no standard ASL sign; assign one custom gesture, or fingerspell via Tier-1 fallback |
| `THANKYOU` | greeting | |
| `COME` | general | "I'm coming" |
| `YES` / `NO` | general | confirmations |
| `EMERGENCY` | emergency | ⚠️ high sample count |
| `HELP` | emergency | ⚠️ |
| `DEAF` | emergency | "I'm Deaf" |
| `AMBULANCE` | emergency | ⚠️ |
| `PAIN` | general | symptom |
| `IDLE` | negative | **required** — hands resting / non-signing, so the model can say "nothing" |

The classifier only emits these tokens. Actual sentences ("I need one strip of Metformin") are assembled by the LLM from the tokens, and drug/number/address specifics are validated fields — never invented by the model (per `PLAN.md` design guarantees). `phrases.ts` maps each token → display text + spoken text + `isEmergency`.

## 3. Data collection protocol

The single biggest driver of live accuracy is **collecting data that looks like the demo**.

- **Samples per sign:** 30–50 for general signs, **60–80 for emergency signs** (`EMERGENCY`, `HELP`, `AMBULANCE`).
- **Vary within each sign:** lighting (bright / dim / backlit), distance (arm's length vs. closer), slight angle changes, and — if two people will ever demo — record **both signers**. Variation is what makes it robust; identical repeats overfit.
- **Signer:** at minimum the person who will demo on stage. A second signer materially improves generalization but isn't required for a hackathon.
- **Idle class:** record plenty of resting hands, adjusting-glasses, mid-transition motion → label `IDLE`. Without this the model forces every frame into a real sign and false-fires constantly.
- **Capture tool:** a 40-line webcam script that writes clips to `data/extracted_dynamic/{GLOSS}/{n}.mp4`, or record on the phone and copy over. Match the **camera height and framing** you'll use live.
- **Emergency realism:** capture `EMERGENCY`/`HELP` at the exact speed and urgency you'll sign them on stage — panic changes signing tempo.

## 4. Landmark extraction

Run MediaPipe over the clips to produce fixed-length sequences.

- **Feature vector:** two hands × 21 landmarks × 3 coords = **126 dims/frame** (SignLens default). Hands-only keeps train/serve parity simple and matches `react-native-fast-tflite` easily.
- **Optional pose:** arm-heavy signs (`AMBULANCE`, `HELP`) *may* benefit from a small pose subset, at the cost of a bigger feature vector and matching work on the RN side. **Default: hands-only.** Only add pose if validation shows those signs confusing.
- **Window length:** **standardize on one number in both Python and the app.** `PLAN.md` currently sets `WINDOW = 40` in `useSignRecognition.ts`; SignLens uses `30`. Pick one — recommend **30** to reuse SignLens defaults — and update the other side to match. Mismatch here silently destroys accuracy.
- **Normalization:** wrist-origin translation + scale by wrist→middle-MCP distance (SignLens already does this). Whatever you choose, it must be **byte-for-byte identical** in the app's frame processor.
- **Padding/masking:** shorter clips zero-padded to the window with masking; longer clips center-cropped or mean-pooled.

## 5. Model architecture

Small on purpose — it runs every N frames on a phone.

- **Baseline:** SignLens LSTM — input `(30, 126)` → 1–2 LSTM layers → dense → softmax over the gloss set. Fast to train, small, good enough for ~15 classes.
- **Alternative:** 1D-CNN or a 2-block tiny Transformer (the VectorNd approach) if the LSTM underfits — unlikely at this class count.
- **Keep it tiny:** favor a model that quantizes cleanly to int8 and stays a few hundred KB.

## 6. Train/serve parity — the #1 failure mode

A model that scores 95% in Python and fails live almost always has a **preprocessing mismatch** between training and the app. Lock these to be identical on both sides *before* trusting any number:

1. **Landmark order** — same indices, same left/right-hand convention, same concatenation order (`[Left_63, Right_63]`).
2. **Normalization** — same origin, same scale factor, same formula.
3. **Window length & stride** — the `30`-vs-`40` decision from §4, applied everywhere.
4. **Frame rate** — sequences should represent a similar real-time span as the app's capture; if training clips are 30fps and the app runs the classifier on a slower effective rate, retime.
5. **NaN / missing-hand handling** — same rule (e.g. drop the emptier half, per the Kaggle approach) in both places.
6. **Which hands/pose** — if you added pose in training, the app must feed pose too.

Write these down as constants shared conceptually between `ml/` and `features/signing/landmarkFrameProcessor.ts`.

## 7. Training run

- **Split:** ~80/20 train/val, **stratified by sign**, and hold out at least a few *whole recording sessions* so val isn't just near-duplicate frames of train.
- **Class weighting:** upweight emergency classes so they aren't sacrificed for average accuracy.
- **Augmentation:** small coordinate jitter, mild time-warp/frame-drop, and **horizontal mirror** (with left/right-hand swap) to cover handedness.
- **Early stopping** on val loss; keep the best checkpoint.
- **Read the confusion matrix, not just accuracy.** Specifically check: does anything get confused *with* an emergency sign, and does any emergency sign get missed? Those two cells matter more than overall %.

## 8. Export to TFLite

- Convert the best `.keras` → TFLite with **int8 quantization** (representative dataset = a sample of your landmark sequences).
- Verify the TFLite **input/output tensor shapes** match what `react-native-fast-tflite` will feed: input `(1, 30, 126)` (or your chosen window), output `(1, num_classes)`.
- Drop the file at **`app/assets/models/sign_asl.tflite`** and the label order at `data/phrases.ts` (must match the softmax index order exactly).
- Sanity-check parity: run the same landmark sequence through the Keras model and the TFLite model — outputs should match within quantization error.

## 9. Validation against MUDRA+ (on-device)

Straight from the `PLAN.md` verification section, applied to the trained model:

- **Per-sign:** sign each gloss **10× on the iQOO**, record confidence + whether `argmax` is correct. Anything <90% gets more training data.
- **Threshold tuning:** set the confidence `THRESHOLD` so `IDLE` and low-confidence frames never emit a candidate. Bias toward *missing* a sign (user re-signs) over *emitting the wrong one*.
- **Emergency gate:** confirm a misrecognized emergency sign **cannot** dial — the double-confirm gate still stands between classifier and call. The model is never the last line of defense.
- **Latency:** measure sign→gloss end-to-end; must stay **<1s** on-device.
- **Full-flow:** reproduce both demo scenarios (pharmacy + emergency) with the real model swapped in for the mock classifier.

## 10. Fallback chain

- **Out-of-vocabulary word** (e.g. a drug not in the set) → **Tier-1 fingerspelling** model (SignBridge-style A–Z).
- **Low confidence** → emit nothing, prompt re-sign; never guess.
- **Model load failure** → the **mock classifier** from `PLAN.md` Phase 2 still returns canned glosses, so the app keeps demoing.

## 11. Timeline (hackathon-scale)

| Block | Task | Output |
|---|---|---|
| ~2 hrs | Fork SignLens, get `main.py` running on 3–4 test signs | pipeline proven end-to-end |
| ~3 hrs | Record the full gloss set (§3), including `IDLE` | `data/extracted_dynamic/` |
| ~1 hr | `extract_landmarks.py` → sequences | `data/sequences_lstm/` |
| ~1–2 hrs | Train, read confusion matrix, iterate on weak signs | `lstm_model.keras` |
| ~1 hr | TFLite export + parity check | `sign_asl.tflite` |
| ~1–2 hrs | On-device validation (§9), threshold tuning | demo-ready model |

Because the app already runs on the **mock classifier**, all of this can happen **in parallel with app work** and only needs to land by the final integration pass — exactly the Phase-8 slot in `PLAN.md`.

## 12. Done criteria

- [ ] All demo-flow signs recognized ≥90% on held-out own-signing.
- [ ] `IDLE` reliably suppresses non-signing frames.
- [ ] No sign confused with an emergency sign in the confusion matrix.
- [ ] `sign_asl.tflite` runs on the iQOO within the <1s budget.
- [ ] Both demo scenarios reproduce end-to-end with the real model.
- [ ] Fingerspelling fallback + confidence threshold + mock classifier all wired.
