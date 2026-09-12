package com.mudraapp.recognition

import com.mrousavy.camera.frameprocessors.Frame
import com.mrousavy.camera.frameprocessors.FrameProcessorPlugin
import com.mrousavy.camera.frameprocessors.VisionCameraProxy

/**
 * VisionCamera Frame Processor Plugin: runs MediaPipe's HandLandmarker on the
 * live camera frame and returns one hand's 21 landmarks as a JS-compatible
 * array of {x,y,z} maps — the exact shape src/recognition/types.ts's
 * `HandLandmark[]` expects, so the JS side can pass the result straight into
 * `recognizeLandmarks()` with no reshaping.
 *
 * Registered under the name "detectHandLandmarks" (see MainApplication.kt).
 * JS side: `VisionCameraProxy.initFrameProcessorPlugin('detectHandLandmarks')`.
 *
 * Returns `null` when no hand is detected in the frame — the JS worklet
 * should treat that like TRAINING.md's IDLE case: emit nothing, never guess.
 */
class HandLandmarksFrameProcessorPlugin(proxy: VisionCameraProxy) : FrameProcessorPlugin() {
    // Lazily created on first frame so plugin registration itself (which
    // happens at app startup, before any Activity/Context churn settles)
    // never pays the model-load cost.
    private var helper: HandLandmarkerHelper? = null
    private val context = proxy.context

    override fun callback(frame: Frame, params: Map<String, Any>?): Any? {
        try {
            val h = helper ?: HandLandmarkerHelper(context).also { helper = it }

            val bitmap = HandLandmarkerHelper.imageProxyToBitmap(frame.imageProxy)
            val mpImage = HandLandmarkerHelper.toMPImage(bitmap)
            val result = h.detect(mpImage)

            val hands = result.landmarks()
            if (hands.isEmpty()) return null

            // One hand only (NumHands=1) — TRAINING.md's Tier-3 pipeline is
            // single-hand; return it as a plain JS array of {x,y,z} maps.
            return hands[0].map { landmark ->
                mapOf(
                    "x" to landmark.x().toDouble(),
                    "y" to landmark.y().toDouble(),
                    "z" to landmark.z().toDouble(),
                )
            }
        } catch (e: Throwable) {
            // A frame processor throwing rethrows in JS on every frame, which
            // would spam errors at camera frame rate. Fail closed to "no
            // hand detected" instead — matches the recognizer's own
            // never-guess-on-uncertainty design.
            return null
        }
    }
}
