# Development

The [README](../README.md#build-from-source) covers the backend and starting the Expo dev server. This page covers
getting the app onto a phone and previewing it without one.

## On a phone

With Expo Go and Tailscale on the phone, open `exp://<server's Tailscale IP>:8083`. For a standalone build with a free
Apple ID, run `npx expo run:ios --device --configuration Release` on a Mac with the phone connected, after picking a
Personal Team under Signing & Capabilities in `ios/ios/Hearth.xcworkspace`. Re-running the same command reinstalls
over the old copy and keeps the token and cached data.

## Browser preview

For layout work without a phone, `npx expo start --web --port 8083` plus
`HEARTH_TOKEN=... HEARTH_LOGIN=<owner> node scripts/preview.mjs` serves the web build and the API from one origin on
`http://127.0.0.1:8091`, adding the credentials the phone would send. It only listens on localhost.
