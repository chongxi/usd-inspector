# Responsive environment rendering

The viewer already uses Three.js r186 and WebGL2. The previous default was progressive path tracing when still, with four full-scene shadow updates when the robot moved. Changing the engine alone would not remove that work.

## Architecture

- Batch different opaque meshes with identical material state in `THREE.BatchedMesh`. Preserve individual transforms and cull each instance against both camera and shadow frusta. Transparent and mirrored meshes remain separate. If `WEBGL_multi_draw` is unavailable, use shared geometry in spatial `InstancedMesh` cells instead of the expensive per-object multi-draw fallback.
- Cache the static PCF depth maps. When the robot moves, copy that depth and render only the robot into the existing depth buffer. Rebuild the static cache when the selected lights or ceiling visibility change. The test fixture compares four robot poses and a changed static wall against full shadow recomputation; the pixel difference is zero.
- Keep all 30 authored USD lights and PBR textures. Balanced mode uses 16-sample contact shadows at half resolution, a denoising pass, MSAA and an HDR color pass. High detail restores full-resolution 32-sample contact shadows. Geometry is not decimated.
- Cap balanced 3D rendering at 2,073,600 pixels and a 1.5 device-pixel ratio. DOM controls remain at native display resolution. This is a pixel budget, not a promise of a specific frame rate on every GPU.
- Default to real-time rendering. Path tracing is an explicit Photo mode; its code/worker load on demand. Static views do not continuously consume GPU time in real-time mode. Switching back disposes path-tracing buffers and workers.
- Keep the original USDZ unchanged: simulation physics, geometry, joint semantics and downloadable textures are not affected by viewer optimizations.

This follows established real-time engine techniques: [Three.js multi-draw batching](https://threejs.org/docs/pages/BatchedMesh.html), [PlayCanvas draw-call, pixel and light budgeting](https://developer.playcanvas.com/user-manual/optimization/guidelines/), and [Unity HDRP mixed cached shadows](https://docs.unity.cn/Packages/com.unity.render-pipelines.high-definition%4015.0/manual/Shadows-in-HDRP.html). [PlayCanvas lightmaps](https://developer.playcanvas.com/user-manual/graphics/lighting/runtime-lightmaps/) are another option for static architecture; this implementation caches shadows, not a baked global-illumination lightmap.

Browser rendering still differs from Isaac RTX. Photo mode remains expensive, and measured timings on the development GPU are not laptop/mobile guarantees. A game networking layer would synchronize robot poses; it would not reduce local shader or shadow rendering cost.

## Measured result

Measured on an NVIDIA RTX PRO 6000 Blackwell Max-Q with hardware-accelerated Chrome, 1440×900 at DPR 1. The old source is commit `3908336`; both runs use the same USDZ and replay the same driving and camera-orbit scenarios. GPU tests run sequentially; the machine is shared, not an exclusive benchmark host.

| Workload / metric | Previous | Balanced real-time |
| --- | ---: | ---: |
| Driving: median GPU time | 12.46 ms | 3.91 ms (−69%) |
| Driving: 95th-percentile GPU time | 15.30 ms | 6.01 ms |
| Driving: median CPU frame submission | 12.4 ms | 4.2 ms |
| Driving: median draw calls, all passes | 4,059 | 293 (−93%) |
| Driving: submitted triangles, all passes | 35.41 million | 1.98 million |
| Camera orbit: median GPU time | 4.43 ms | 2.63 ms |
| Camera orbit: 95th-percentile GPU time | 10.94 ms | 4.84 ms |
| Environment draw groups | 1,069 | 440 |
| Local environment load | 3.43 s | 3.55 s |

Both runs reached the display's approximately 60 Hz limit. These are reductions in rendering work, not a claim of tripled observed FPS or faster downloads. No source triangles were removed: the authored environment still contains 5,693,668 triangles and 17 textures. Submitted triangles count repeated render passes, so shadow caching and culling reduce that number without changing the source model.

With `WEBGL_multi_draw` deliberately disabled, the spatial-instancing fallback measured 4.04 ms median GPU time while driving, with 521 draws and no WebGL errors. Balanced real-time issued zero render frames during the 2.5-second idle check. Four cached 2048² shadow targets trade additional GPU memory for lower per-frame work.

The shadow correctness fixture matched full shadow recomputation pixel for pixel at all four robot poses and after moving a static wall. Browser checks cover downloads, driving, joints, Reach, robot switching, placement, ceiling visibility, Photo-mode convergence, and resource disposal. Detailed JSON reports and screenshots are saved under the invoking workspace's `results/usd_inspector_performance/` directory; they are regenerable evidence, not runtime dependencies.

The benchmark used the asset at commit `9120f0d`, before later prop revisions, with SHA-256 `73cc87c4fbbee7cce173621b4f5d0cd4c51d23bc6da6012d4f3d28f41dfba04d`.

## Reproduce

Start `npm run serve` and run these checks one at a time (avoid concurrent GPU benchmarks):

```sh
npm test
CHROMIUM_GPU=1 npm run test:browser
npm run test:shadows
npm run test:rendering
npm run test:railing
BASELINE_REF=3908336 EVIDENCE_DIR=../results/usd_inspector_performance/baseline_final npm run test:performance
EVIDENCE_DIR=../results/usd_inspector_performance/candidate_final npm run test:performance
DISABLE_MULTIDRAW=1 EVIDENCE_DIR=../results/usd_inspector_performance/fallback npm run test:performance
```

The performance harness injects instrumentation only into the test document, replays the same drive and orbit at 1440×900 / DPR 1, records CPU frame submission and asynchronous `EXT_disjoint_timer_query_webgl2` GPU timings, and reports draw calls/triangles summed across all passes. It does not use `gl.finish()`. The baseline loads the selected Git revision's source via test routes; it does not modify the checkout or asset. Frame intervals are display limited, so reduced GPU work must not be presented as an equivalent multiplication in observed FPS.
