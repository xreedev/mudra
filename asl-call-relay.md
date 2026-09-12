# ASL-to-speech call relay — architecture notes

## Goal
An app detects ASL from camera input, converts it to text, then converts that
text to speech so the other party on an active phone call can hear it —
entirely on-device, no cloud telephony provider.

## Key constraint
Android does not let third-party apps inject audio directly into the
outgoing voice channel of a normal cellular call. There's no public API for
that. The workaround is **acoustic coupling**: play the synthesized speech
out loud on speakerphone, and let the phone's own microphone (already open
for the call) pick it up and transmit it.

Tradeoff: much simpler than a cloud telephony setup, but audio quality is
lower and it can be defeated by echo cancellation (see caveats below).

## Architecture

```
ASL camera input → text (existing app) → TextToSpeech → phone speaker
                                                              ↓ (acoustic pickup)
                                                          phone mic
                                                              ↓
                                                     other party on call
```

## React Native implementation steps

1. **Install native modules**
   ```
   npm install react-native-call-detection react-native-incall-manager react-native-tts
   ```
   - `react-native-call-detection` — exposes call state (ringing/offhook/idle) to JS
   - `react-native-incall-manager` — handles speakerphone/audio routing (built for VoIP apps)
   - `react-native-tts` — text-to-speech
   - iOS has no equivalent for call detection or in-call audio routing — Android only in practice.

2. **Request permissions**
   - Add `READ_PHONE_STATE` to `AndroidManifest.xml`
   - Request at runtime: `PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE)`
   - Without this granted, call-state detection silently won't fire.

3. **Detect the active call**
   ```js
   import CallDetectorManager from 'react-native-call-detection';

   new CallDetectorManager(
     (event) => {
       if (event === 'Offhook') {
         // call connected — turn on speakerphone
       }
     },
     true,
     () => {},
     { title: '...', message: '...' }
   );
   ```
   Fires on `Incoming` / `Offhook` / `Disconnected`.

4. **Turn on speakerphone**
   ```js
   import InCallManager from 'react-native-incall-manager';

   InCallManager.start({ media: 'audio' });
   InCallManager.setSpeakerphoneOn(true);
   ```
   Call this once the call state is `Offhook`.

5. **Speak the ASL-to-text output**
   ```js
   import Tts from 'react-native-tts';

   Tts.speak(text);
   ```
   By default this plays on the normal media stream, not the in-call voice
   stream — `react-native-tts` doesn't expose Android's `KEY_PARAM_STREAM`
   option. Fine for a first test; revisit if audio behaves inconsistently
   during real calls.

6. **(If needed) Custom native module for the voice-call stream**
   No current RN TTS library exposes Android's `STREAM_VOICE_CALL` routing.
   If step 5's default behavior isn't reliable enough, write a small
   (~20-line) native Android module wrapping Android's own `TextToSpeech`
   class with the `KEY_PARAM_STREAM` bundle param, exposed to JS via
   `NativeModules` as e.g. `speakOnCallStream(text)`.

7. **Test on your actual target device early**
   Do a real call test (speakerphone + `Tts.speak()`) before building
   further — behavior varies a lot by phone manufacturer.

## Caveat: echo cancellation

In-call audio processing usually includes echo cancellation (AEC), designed
to detect and remove exactly the kind of speaker-into-mic sound this
approach relies on. On some devices this can quietly suppress the TTS output
before it reaches the other party. There's no reliable public API to disable
AEC per-app. Partial workarounds:
- Try `AudioSource.VOICE_COMMUNICATION` vs `VOICE_RECOGNITION` — they have
  different AEC behavior on some devices.
- A wired/external speaker angled away from the mic sometimes helps.

This is device-dependent — test early rather than assuming it'll work
everywhere.
