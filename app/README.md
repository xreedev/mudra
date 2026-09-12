This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

>**Note**: Make sure you have completed the [React Native - Environment Setup](https://reactnative.dev/docs/environment-setup) instructions till "Creating a new application" step, before proceeding.

## Step 1: Start the Metro Server

First, you will need to start **Metro**, the JavaScript _bundler_ that ships _with_ React Native.

To start Metro, run the following command from the _root_ of your React Native project:

```bash
# using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Start your Application

Let Metro Bundler run in its _own_ terminal. Open a _new_ terminal from the _root_ of your React Native project. Run the following command to start your _Android_ or _iOS_ app:

### For Android

```bash
# using npm
npm run android

# OR using Yarn
yarn android
```

### For iOS

```bash
# using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up _correctly_, you should see your new app running in your _Android Emulator_ or _iOS Simulator_ shortly provided you have set up your emulator/simulator correctly.

This is one way to run your app — you can also run it directly from within Android Studio and Xcode respectively.

## Step 3: Modifying your App

Now that you have successfully run the app, let's modify it.

1. Open `App.tsx` in your text editor of choice and edit some lines.
2. For **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Developer Menu** (<kbd>Ctrl</kbd> + <kbd>M</kbd> (on Window and Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (on macOS)) to see your changes!

   For **iOS**: Hit <kbd>Cmd ⌘</kbd> + <kbd>R</kbd> in your iOS Simulator to reload the app and see your changes!

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [Introduction to React Native](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you can't get this to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.

---

## MUDRA+ UI scaffold

Four destinations, real navigation and a real design system, with placeholder data. This build is
the **design**, not the pipeline: no recognition, no call bridge, no model.

```
src/
├── theme/        design tokens (colour, spacing, radius, type) + ThemeProvider
├── components/   Screen, Text, Button, IconButton, Card, TextField, Tile,
│                 GlossChips, EmptyState, Icon (hand-written 24px SVG set), CameraStage
├── navigation/   flat stack under Home
├── screens/      Home · Call · Memory · AddSign · Chat
└── data/mock.ts  seed content — the shapes the real layers should produce
```

**Screens**

| Screen | What it does now |
|---|---|
| Home | Wordmark, 2x2 tile grid, on-device privacy line |
| Call someone | Contact picker (emergency contact visually separated), then a camera-first call view: recognized glosses, the draft sentence, and a "Confirm & speak" gate above the call controls |
| Memory | Searchable list of gloss-sequence → sentence pairs, pin/delete, inline "new phrase" form |
| Add custom sign | Camera frame with a reticle, capture, then label the snapshot underneath and save |
| Chatbot | Message list and composer; replies are canned |

**Conventions** — screens never hard-code a colour or a pixel gap (everything comes from
`src/theme`), text goes through the `Text` primitive, icon-only controls always carry an
`accessibilityLabel`, and nothing interactive is under 44pt. Dark mode follows the system
setting.

`CameraStage` loads `react-native-vision-camera` lazily and falls back to a designed placeholder
when the native module is missing or permission is refused — so a fresh clone renders every
screen before any native build has run.

```bash
npm install
npm start                 # Metro
npm run android           # or: npm run ios  (cd ios && pod install first)
npm test                  # 4 smoke tests: every screen mounts with no camera and no data
npx tsc --noEmit          # typecheck
```

The app icon is generated (teal speech bubble, `assets/app-icon.png`), wired into Android
adaptive icons and the iOS asset catalog.
