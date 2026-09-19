import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

// Same-origin module worker: unlike the page, workers have no import map.
await mkdir('src/vendor', { recursive: true });
await build({
  stdin: { contents: `export { WebGLPathTracer, GradientEquirectTexture } from 'three-gpu-pathtracer';
    export { GenerateMeshBVHWorker } from './node_modules/three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js';`,
    resolveDir: process.cwd() },
  bundle: true, format: 'esm', minify: true, external: ['three', 'three/*'],
  outfile: 'src/vendor/pathtracer.js', legalComments: 'linked',
  plugins: [{ name: 'three-addons', setup(builder) {
    builder.onResolve({ filter: /^three\/examples\/jsm\// }, args => ({
      path: args.path.replace('three/examples/jsm/', 'three/addons/'), external: true,
    }));
  } }],
});
await build({ entryPoints: ['node_modules/three-mesh-bvh/src/workers/generateMeshBVH.worker.js'],
  bundle: true, format: 'esm', minify: true, legalComments: 'linked',
  outfile: 'src/vendor/generateMeshBVH.worker.js' });
for (const name of ['three', 'three-mesh-bvh', 'three-gpu-pathtracer']) {
  await copyFile(`node_modules/${name}/LICENSE`, `src/vendor/${name}.LICENSE`);
}
