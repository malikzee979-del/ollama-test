# ollama-chat-mobile-rn

The React Native port of the Flutter app in [../mobile](../mobile): the same
thin native client for the Ollama Chat server, rebuilt with Expo + React
Navigation. Feature-for-feature: server setup (ping-before-save), signup /
login against `/api/auth/*`, the session register, the model picker, and
streaming chat over the server's NDJSON `/api/chat` proxy.

Differences from the Dart client, all noted in the code:

- **Auth cookies.** React Native's fetch cannot read `Set-Cookie`, so instead
  of capturing the `sid` cookie by hand (as `api_client.dart` does) the app
  relies on the platform cookie jars (NSHTTPCookieStorage / webkit
  CookieManager), which store, resend, and persist cookies automatically and
  scope them per host. Login state comes from `GET /api/auth/me`.
- **Fonts.** Each IBM Plex weight registers as its own family name.

## Setup

```bash
npm install
npx expo run:android     # builds + installs on a running Android emulator
# or: npx expo run:ios   (requires Xcode)
```

On first launch, enter the server's address — for an Android emulator that's
`http://10.0.2.2:4173` (the host machine's loopback), for a real phone the
machine's LAN IP.

## End-to-end test

`e2e/flow.mjs` drives the full flow (server setup → signup → chat with a
real streaming reply → persistence → delete → logout → log back in) against
the live server + Ollama, via adb on a running emulator:

```bash
npm start                # in the repo root: Ollama Chat server on :4173
node e2e/flow.mjs        # requires the Pixel_8_API_35 emulator booted
```
