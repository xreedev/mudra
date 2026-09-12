#!/usr/bin/env python3
"""
Export a `sign_embed.tflite` feature extractor from an existing trained
sign classifier — no retraining, just re-exposing an internal layer.

Usage:
    python export_embedding_model.py \
        --model path/to/sign_asl.keras \
        --layer -2 \
        --out sign_embed.tflite

`--layer` accepts either an integer index (Python-style, so -2 = the layer
just before the final Dense/softmax classification head — usually what you
want) or a layer name (see --list-layers to find it).

Requires the ORIGINAL Keras/TF model (Case A in INTEGRATION.md), not just
the already-exported classifier .tflite. If only the .tflite is available
(Case B), see the note at the bottom of this file instead — this script
does not cover that path.
"""
import argparse

import tensorflow as tf


def list_layers(model: tf.keras.Model) -> None:
    for i, layer in enumerate(model.layers):
        out_shape = getattr(layer, "output_shape", "?")
        print(f"  [{i}] {layer.name:30s} -> {out_shape}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", required=True, help="Path to the ORIGINAL trained model (.keras/.h5), not the .tflite")
    ap.add_argument("--layer", default="-2", help="Layer index (e.g. -2) or layer name to expose as the embedding output")
    ap.add_argument("--out", default="sign_embed.tflite", help="Output TFLite file path")
    ap.add_argument("--list-layers", action="store_true", help="Print the model's layers (with shapes) and exit — use this first to pick --layer")
    ap.add_argument("--quantize", action="store_true", help="Apply default (dynamic-range) TFLite quantization, matching sign_asl.tflite's own export step")
    args = ap.parse_args()

    model = tf.keras.models.load_model(args.model)

    if args.list_layers:
        print(f"Layers in {args.model}:")
        list_layers(model)
        return

    # Resolve --layer as either an int index or a layer name.
    try:
        layer_ref = model.layers[int(args.layer)]
    except ValueError:
        layer_ref = model.get_layer(args.layer)

    print(f"Using layer '{layer_ref.name}' (output shape {layer_ref.output_shape}) as the embedding.")
    embed_model = tf.keras.Model(inputs=model.input, outputs=layer_ref.output)

    converter = tf.lite.TFLiteConverter.from_keras_model(embed_model)
    if args.quantize:
        converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_bytes = converter.convert()

    with open(args.out, "wb") as f:
        f.write(tflite_bytes)

    print(f"Wrote {args.out} ({len(tflite_bytes) / 1024:.0f} KB)")
    print("Sanity check: run the SAME input window through both sign_asl.tflite")
    print("and this file — the embedding should be a stable, non-degenerate vector")
    print("(not all-zeros / all-identical across different signs) before trusting it.")


if __name__ == "__main__":
    main()

# ── Case B note (only the exported .tflite is available, no Keras source) ──
# TFLite still computes intermediate tensors internally even when they
# aren't declared outputs. You can inspect the graph in Netron to find the
# tensor index just before the final softmax op, then after
# interpreter.invoke(), read it directly:
#     interpreter.get_tensor(that_tensor_index)
# This is more fragile (the index can shift if the model is ever
# re-exported/re-quantized differently) — prefer the Keras-source path
# above whenever the original model file is available.
