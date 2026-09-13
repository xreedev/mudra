<#
.SYNOPSIS
  Builds a single, self-contained release APK with the on-device LLM bundled in.

.DESCRIPTION
  Automates what was previously a manual multi-step process:

  1. Copies a .gguf model into android/app/src/main/assets/models/, named to
     match MODEL_FILENAME in src/llm/useLocalLlm.ts - the app extracts it from
     there to its real runtime path on first launch (see useLocalLlm.ts), so
     the release APK needs no separate `adb push` step.
  2. Works around a Windows MAX_PATH (260-char) issue in react-native-vision-camera's
     release CMake build: builds through a short-path directory junction instead
     of this (often long, space-containing) project path.
  3. Works around an OOM in AGP's `compressReleaseAssets` task when it has to
     process a multi-GB asset even with `noCompress` set: temporarily raises
     the Gradle daemon heap, then restores the original gradle.properties
     afterward no matter what (even on failure) - this machine's heap is
     deliberately capped low for day-to-day native builds, so this must not
     leak into later builds.

.PARAMETER ModelPath
  Path to the .gguf file to bundle. Optional - if omitted, reuses whatever is
  already at android/app/src/main/assets/models/<MODEL_FILENAME>, and fails if
  nothing is there yet.

.PARAMETER HeapMb
  Temporary Gradle daemon heap size in MB for this build only. Default 4096 -
  bump this if compressReleaseAssets still OOMs on a larger model.

.EXAMPLE
  .\build-release-with-llm.ps1 -ModelPath C:\models\qwen2.5-3b-instruct-q4_k_m.gguf

.EXAMPLE
  .\build-release-with-llm.ps1
  # Reuses the model already bundled from a previous run.
#>
param(
  [string]$ModelPath,
  [int]$HeapMb = 4096
)

$ErrorActionPreference = 'Stop'

$AppDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$AndroidDir = Join-Path $AppDir 'android'
$GradlePropertiesPath = Join-Path $AndroidDir 'gradle.properties'
$UseLocalLlmPath = Join-Path $AppDir 'src\llm\useLocalLlm.ts'
$AssetsModelsDir = Join-Path $AndroidDir 'app\src\release\assets\models'

# --- 1. Resolve the expected filename from the app's own source, so the
#        bundled asset always matches what useLocalLlm.ts actually looks for.
$useLocalLlmContent = Get-Content $UseLocalLlmPath -Raw
$filenameMatch = [regex]::Match($useLocalLlmContent, "MODEL_FILENAME\s*=\s*'([^']+)'")
if (-not $filenameMatch.Success) {
  throw "Could not find MODEL_FILENAME in $UseLocalLlmPath - has useLocalLlm.ts changed shape?"
}
$modelFilename = $filenameMatch.Groups[1].Value
$assetModelPath = Join-Path $AssetsModelsDir $modelFilename

Write-Host "Expected model filename (from useLocalLlm.ts): $modelFilename"

if (-not (Test-Path $AssetsModelsDir)) {
  New-Item -ItemType Directory -Path $AssetsModelsDir -Force | Out-Null
}

if ($ModelPath) {
  if (-not (Test-Path $ModelPath)) {
    throw "Model file not found at: $ModelPath"
  }
  Write-Host "Copying model into assets (this can take a while for a multi-GB file)..."
  Copy-Item -Path $ModelPath -Destination $assetModelPath -Force
} elseif (-not (Test-Path $assetModelPath)) {
  throw "No -ModelPath given and nothing already bundled at $assetModelPath. Pass -ModelPath pointing at the .gguf to bundle."
}

$modelSizeMb = [math]::Round((Get-Item $assetModelPath).Length / 1MB)
Write-Host "Bundled model: $assetModelPath ($modelSizeMb MB)"

# --- 2. Build through a short-path junction to dodge the Windows MAX_PATH
#        issue in vision-camera's release CMake build (see module docstring).
$junctionPath = 'C:\mudra-relbuild'
if (-not (Test-Path $junctionPath)) {
  cmd /c mklink /J $junctionPath "$AppDir\.." | Out-Null
}
$junctionAndroidDir = Join-Path $junctionPath 'app\android'

# --- 3. Temporarily raise the Gradle daemon heap for this build only.
$gradlePropertiesBackup = "$GradlePropertiesPath.buildscript.bak"
Copy-Item -Path $GradlePropertiesPath -Destination $gradlePropertiesBackup -Force

try {
  $content = Get-Content $GradlePropertiesPath -Raw
  $newContent = [regex]::Replace(
    $content,
    'org\.gradle\.jvmargs=-Xmx\d+m(.*)',
    "org.gradle.jvmargs=-Xmx${HeapMb}m`$1"
  )
  if ($newContent -eq $content) {
    Write-Warning "Did not find an org.gradle.jvmargs line to bump - proceeding with whatever's already set."
  }
  Set-Content -Path $GradlePropertiesPath -Value $newContent -NoNewline

  Write-Host "Stopping any running Gradle daemon so the raised heap actually applies..."
  Push-Location $junctionAndroidDir
  & .\gradlew.bat --stop

  Write-Host "Building release APK (this packages a multi-GB asset - expect several minutes)..."
  & .\gradlew.bat app:assembleRelease --no-parallel
  if ($LASTEXITCODE -ne 0) {
    throw "gradlew app:assembleRelease failed with exit code $LASTEXITCODE"
  }
  Pop-Location
} finally {
  # Always restore the original gradle.properties, even if the build failed -
  # this machine's heap is deliberately capped low for routine native builds.
  Copy-Item -Path $gradlePropertiesBackup -Destination $GradlePropertiesPath -Force
  Remove-Item $gradlePropertiesBackup -Force
}

$apkPath = Join-Path $AndroidDir 'app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $apkPath)) {
  throw "Build reported success but the APK isn't at the expected path: $apkPath"
}
$apkSizeMb = [math]::Round((Get-Item $apkPath).Length / 1MB)
Write-Host ""
Write-Host "Done: $apkPath ($apkSizeMb MB)"
