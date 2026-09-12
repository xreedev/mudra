pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "mudra-memory"

// :core is pure Kotlin/JVM — it builds and tests on any machine, Android SDK or not.
include(":core")

// :android needs the Android SDK. Android Studio always has it; a bare CI container may not,
// and configuring the Android plugin without an SDK fails the whole build, so it is opt-in by
// presence of the SDK (or `-PforceAndroidModule=true`).
val hasAndroidSdk = System.getenv("ANDROID_HOME") != null ||
    System.getenv("ANDROID_SDK_ROOT") != null ||
    file("local.properties").takeIf { it.exists() }
        ?.readText()?.contains("sdk.dir") == true
if (hasAndroidSdk || providers.gradleProperty("forceAndroidModule").orNull == "true") {
    include(":android")
} else {
    logger.lifecycle(
        "[mudra-memory] Android SDK not found - configuring :core only. " +
            "Open in Android Studio (or set ANDROID_HOME) to build :android.",
    )
}
