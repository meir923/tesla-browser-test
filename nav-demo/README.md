# דרך — street-level FSD-inspired navigation prototype (v4)

Standalone browser demo, no build step:

    python3 -m http.server 8768 --directory /workspace/nav-demo

Open http://127.0.0.1:8768/ at 1600×900. Only three.js and the optional web font need CDN access; the actual route and street geometry are cached locally.

## This revision

The former MapLibre aerial camera and independent, enlarged ego overlay are **removed**. One ordinary three.js perspective camera renders the road, ego, other vehicles, buildings and alert sprites together, in metre units with real depth occlusion.

- Default camera: **7.8m behind, 2.35m above ground**, 52° vertical FOV, looking forward 43m at a target height of 1.1m. This is a low, nearly horizontal in-street view, not the earlier elevated proposal. The SUV sits at the bottom centre; white lane lines converge toward a dark, fogged horizon.
- True-scale, rounded white SUV: approximately **4.70m long / 1.90m body width / 1.65m roof height**, with dark cabin glass, mirrors, wheels, door details and red rear lights. No Tesla branding or downloaded vehicle assets.
- Procedural asphalt strip along the actual driving route, with **three 3.3m lanes**, solid white edges, dashed dividers with faint halos, raised curb strips and a translucent blue 1.78m-wide ego-lane path.
- Four simulated vehicles: same-direction traffic in the ego/right lane, and two oncoming vehicles in the left lane. Their speeds are illustrative, not detected from sensors.
- Crosswalks, stop lines and green signals are simulated at real cross-street locations computed from OSM geometry. They do **not** describe the verified real-world signal state or exact road layout.
- Compact Hebrew RTL HUD, community report buttons, clearly simulated alerts, speed/limit and ETA. The report button sends nothing externally.
- Real smooth-gray OSM buildings rise on both sides, fading into darkness beyond roughly 35–125m. One merged building mesh and merged static road furniture reduce draw calls. Route position uses C1 interpolation and camera direction a spatially smoothed tangent, not noisy per-segment rotation.

## Data and accuracy

- Actual OSRM driving route, 1.45km along Rothschild Boulevard to Habima, saved in `route.json`.
- Actual OpenStreetMap building footprints/heights and roads from OpenFreeMap's public `20261101` vector-tile snapshot, saved in `street-data.json`. 323 nearby building pieces are retained in a narrow corridor. Some heights are provider estimates, not surveyed values. Buildings within 5.5m of the route were omitted to avoid clipping the illustrative widened roadway.
- The tile schema supplied **no `lanes` tags**. Three lanes and a left oncoming lane are therefore explicit **visualization defaults**, not a claim about Rothschild's actual lane count/direction. Faint side roads use actual geometry, while their surfaces at selected crossings are simplified.
- Crosswalk paint, stop lines, signals, moving objects, community reports, confirmations, speed and ETA are **demonstration data**. This is not an implementation of Tesla FSD, vehicle perception, autonomous driving, lane-level guidance or a safe navigation product.
- No Tesla logo/assets; no GPS, CAN, microphone or account access. No backend reports. CDN access discloses the normal request metadata.
- OSM attribution/ODbL acknowledgement is shown in the page and export. Retain the OSM attribution and offer the derivative street geometry under ODbL when distributing it.

## Recording

Click the recording button, or open `/?record=1`. The page records **24 seconds** of its actual WebGL scene plus a canvas-native Hebrew HUD at **1600×900 / 30fps** and downloads `nav-demo.webm`.

    ffmpeg -y -i nav-demo.webm -r 30 -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -movflags +faststart nav-demo.mp4

For a sanctioned browser worker, `window.demoReady`, `window.renderDemoFrame(seconds)`, `window.demoScene`, `window.demoCamera`, `window.demoRenderer` and `window.fsdStats` are available. `renderDemoFrame` pauses real-time playback and renders immediately. Static geometry is locally cached, so there is no tile-load timing dependency after initial load.

## Checks

    node --check app.js
    node test-static.cjs
    curl -fsS http://127.0.0.1:8768/app.js?v=4

`test-static.cjs` uses three.js scene/math in Node with a renderer stub; it is **not** a browser test. It verifies the actual default camera height/separation, 721 route positions and actual scene construction. Test helper dependencies live outside the publishable demo at `/workspace/nav-demo-tools/`.

### Verification image

`fsd-check.png` is a **native offscreen EGL/llvmpipe render** of the actual scene mesh geometry, transforms and camera exported by the Node check at t=3s. It was visually inspected. The native renderer approximates three.js lighting/materials and adds a matching HUD; it is **not a Chromium screenshot**, and textured alert sprites are omitted in that native preview. Native verification scripts are `/workspace/nav-demo-tools/render-check.py` and `/workspace/nav-demo-tools/scene-check.json`.

No browser automation was available to this executor, so browser/GPU rendering and the new recording still need verification by the parent browser worker. Existing MP4s / older stills in this directory were not regenerated or overwritten. No GitHub changes were made.
