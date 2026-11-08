# דרך — Tel Aviv navigation visualization prototype

Standalone browser demo, no build process. Serve the folder over HTTP, e.g.:

    python3 -m http.server 8768 --directory /workspace/nav-demo

Open http://127.0.0.1:8768/ at 1600×900. CDN internet access is required.

- Actual OSM footprints, roads and mapped building heights: OpenFreeMap vector tiles (ODbL attribution in map and recording).
- Real 1,451.5m driving route on Rothschild Boulevard to Habima, OSRM public demo server, downloaded in `route.json`.
- Heights absent in OSM/tiles fall back to provider estimates / 12m, not surveyed heights.
- Motion, vehicle, speed/ETA, reports and report confirmations are SIMULATED.
- No Tesla assets, sensors, CAN, microphone, account or location access. Reporting buttons only show a local toast.
- Gray 3D buildings with directional lighting; blue route glow; three.js primitive car; Hebrew RTL HUD.
- No data is sent to a reporting backend. Map/CDN requests disclose IP normally.
- The vehicle begins 530m along the real route, travels at 10.5m/s (~38km/h), and loops the presentation after 60s.

## Record in the browser

Click “הקלטת הדגמה · 24 שניות”, or open `/?record=1`. The page records its actual map rendering plus a canvas-native version of the Hebrew HUD into `nav-demo.webm` and automatically downloads it. The recording is not AI-generated. Map marker HTML is reprojected into the export canvas.

Convert after downloading:

    ffmpeg -y -i nav-demo.webm -r 30 -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart /workspace/nav-demo/nav-demo.mp4
    ffmpeg -y -ss 3 -i /workspace/nav-demo/nav-demo.mp4 -frames:v 1 /workspace/nav-demo/still-01.png
    ffmpeg -y -ss 18 -i /workspace/nav-demo/nav-demo.mp4 -frames:v 1 /workspace/nav-demo/still-02.png

For deterministic capture by an approved browser tool, the page exports `window.demoReady` and `window.renderDemoFrame(seconds)` (wait for the map's render event). The latter pauses the real-time animation. HTML HUD is fully capturable by screenshot; 720 frames at 30fps makes 24 seconds. Avoid recording during initial tile load. A visual review of the result is still needed.

## Current validation status

`node --check app.js` passed. Browser/GPU rendering has NOT been run or visually reviewed in this executor environment; no browser-driving tools are available here. Do not represent a video/still as completed until a browser worker renders and reviews it.


## Tight FSD-style chase view revision

- Map camera: zoom **19.18**, pitch **76°**, maximum pitch **85°**. A 35% top inset anchors the ego at **67.5% of the screen height**, above the bottom HUD. No per-frame easing animations are queued.
- Camera and vehicle share a weighted 20m route-heading filter; positions use local C1 Hermite interpolation. These are arc-distance based, so seeking/re-recording yields the same orientation without frame-rate-dependent lag.
- New detailed white sedan: **4.70m physical body length**, beveled body and bumpers, dark outward-facing window glass, roof, pillars, mirrors, handles/door seams, LED strips and five-spoke wheels. No external model or texture downloads.
- **Presentation-scale caveat:** at zoom 19.18, a real 1.9m-wide sedan in the same map projection cannot fill 8–12% of a 1600px display. The default therefore uses a separate, lower three.js ego camera rendering the true-sized model as a screen-anchored visualization glyph (target width ~9%, somewhat wider with mirrors). It is not survey-scale relative to nearby buildings. This is explicit, rather than silently scaling the metre geometry up by 8×. Add `?worldscale=1` for exact map-scale placement, at the cost of a much smaller car. Can combine with `?worldscale=1&record=1`.
- Ego camera uses a 40° vertical FOV, soft radial contact shadow and subtle blue underglow. The map uses the public 45° FOV setter only if supported by its runtime; no private MapLibre transform fields are mutated. With the pinned MapLibre 4.7.1, the native map FOV is retained.
- Buildings are lighter neutral gray with less directional contrast and vertical-gradient shading enabled; existing antialiasing softens edges. Geometry is still actual OSM footprints, not beveled fake blocks.
- Optional dashed markings render only on major roads whose vector tile explicitly has `lanes >= 2`. OpenFreeMap may omit this field, in which case no lane layout is invented. Markings are illustrative, not lane-level navigation.
- Route geometry worker updates are capped at 8Hz, while the vehicle/camera move every animation frame. Reused matrices/materials and one 64px radial texture keep the ego layer lightweight.

### Static validation of this revision

    node --check app.js
    node test-static.cjs
    curl -fsS http://127.0.0.1:8768/app.js

Unit checks cover 1,801 virtual frames, finite positions/headings, frame-to-frame motion, angular wrap, deterministic seeks and retained building gradient. This revision has **not** been browser-rendered or visually reviewed. The existing `still.png` / recording are from before this revision and were not overwritten.
