package com.mudraapp.recognition

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.YuvImage
import androidx.camera.core.ImageProxy
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import java.io.ByteArrayOutputStream

/**
 * Wraps MediaPipe's on-device HandLandmarker task.
 *
 * Ported from the `android_viewer` branch's proven-working implementation
 * (same MediaPipe Tasks Vision version, same YUV->Bitmap conversion), single
 * hand only — the RN sign-recognition pipeline (src/recognition/) only
 * consumes one hand's 21 landmarks per TRAINING.md's Tier-3 approach, unlike
 * android_viewer's two-hand + pose classifier path.
 */
class HandLandmarkerHelper(context: Context) {
    private val landmarker: HandLandmarker = HandLandmarker.createFromOptions(
        context,
        HandLandmarker.HandLandmarkerOptions.builder()
            .setBaseOptions(
                BaseOptions.builder().setModelAssetPath("hand_landmarker.task").build()
            )
            .setRunningMode(RunningMode.IMAGE)
            .setNumHands(1)
            .setMinHandDetectionConfidence(0.5f)
            .setMinHandPresenceConfidence(0.5f)
            .build()
    )

    fun detect(image: MPImage): HandLandmarkerResult = landmarker.detect(image)

    fun close() = landmarker.close()

    companion object {
        /**
         * ImageProxy (YUV_420_888 from a VisionCamera Frame's underlying
         * CameraX ImageAnalysis) -> ARGB_8888 Bitmap. Manual conversion via
         * YuvImage/JPEG round-trip. Assumes a semi-planar YUV_420_888 layout
         * (NV21-compatible U/V interleaving), which covers most devices but
         * isn't guaranteed universal across camera HALs.
         */
        fun imageProxyToBitmap(image: ImageProxy): Bitmap {
            val yBuffer = image.planes[0].buffer
            val uBuffer = image.planes[1].buffer
            val vBuffer = image.planes[2].buffer

            val ySize = yBuffer.remaining()
            val uSize = uBuffer.remaining()
            val vSize = vBuffer.remaining()

            val nv21 = ByteArray(ySize + uSize + vSize)
            yBuffer.get(nv21, 0, ySize)
            vBuffer.get(nv21, ySize, vSize)
            uBuffer.get(nv21, ySize + vSize, uSize)

            val yuvImage = YuvImage(nv21, ImageFormat.NV21, image.width, image.height, null)
            val out = ByteArrayOutputStream()
            yuvImage.compressToJpeg(Rect(0, 0, image.width, image.height), 90, out)
            val bytes = out.toByteArray()
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)

            val rotation = image.imageInfo.rotationDegrees
            if (rotation == 0) return bitmap
            val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
            return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        }

        fun toMPImage(bitmap: Bitmap): MPImage = BitmapImageBuilder(bitmap).build()
    }
}
