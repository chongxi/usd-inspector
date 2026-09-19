import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Edge-aware a-trous filter; stable raster guides preserve mesh and texture boundaries. */
export function createEnvironmentDenoiser(renderer, getNormals, scene, camera) {
  const targets = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, depthBuffer: false,
  }));
  const guide = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const basicMaterials = new Map();
  const uniforms = { image: {value: null}, guide: {value: null}, normals: {value: null},
    texel: {value: new THREE.Vector2()}, stepSize: {value: 1}, firstPass: {value: false}, finalPass: {value: false} };
  const material = new THREE.ShaderMaterial({ uniforms, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
    fragmentShader: `
      uniform sampler2D image, guide, normals;
      uniform vec2 texel;
      uniform float stepSize;
      uniform bool firstPass, finalPass;
      varying vec2 vUv;
      void main(){
        vec3 g=texture2D(guide,vUv).rgb;
        vec3 n=normalize(texture2D(normals,vUv).rgb*2.-1.);
        vec3 sum=vec3(0.); float weights=0.;
        for(int y=-2;y<=2;y++) for(int x=-2;x<=2;x++) {
          vec2 uv=vUv+vec2(float(x),float(y))*texel*stepSize;
          vec3 dg=texture2D(guide,uv).rgb-g;
          vec3 nn=normalize(texture2D(normals,uv).rgb*2.-1.);
          float kernel=exp(-float(x*x+y*y)*.5);
          float w=kernel*exp(-dot(dg,dg)*140.)*pow(max(0.,dot(n,nn)),64.);
          vec3 value=texture2D(image,uv).rgb;
          if(firstPass) value/=max(texture2D(guide,uv).rgb,vec3(.04));
          // Suppress isolated glossy fireflies before spreading them through the filter.
          value=min(value,vec3(12.));
          sum+=value*w; weights+=w;
        }
        gl_FragColor=vec4(sum/max(weights,1e-6),1.);
        if(finalPass) {
          gl_FragColor.rgb*=max(g,vec3(.04));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      }` });
  const quad = new FullScreenQuad(material);
  return {
    capture() {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      if (guide.width !== size.x || guide.height !== size.y) {
        guide.setSize(size.x, size.y);
        for (const target of targets) target.setSize(size.x, size.y);
        uniforms.texel.value.set(1 / size.x, 1 / size.y);
      }
      const saved = [], previous = renderer.getRenderTarget();
      try {
        scene.traverseVisible(object => {
          if (!object.isMesh) return;
          saved.push([object, object.material, object.visible]);
          const original = Array.isArray(object.material) ? object.material : [object.material];
          if (original.every(m => m.transparent && m.opacity < .95)) { object.visible = false; return; }
          const materials = original.map(source => {
            let material = basicMaterials.get(source.uuid);
            if (!material) {
              material = new THREE.MeshBasicMaterial({ color: source.color, map: source.map,
                side: source.side, vertexColors: source.vertexColors, alphaTest: source.alphaTest,
                opacity: source.opacity, transparent: source.transparent, toneMapped: false });
              basicMaterials.set(source.uuid, material);
            }
            return material;
          });
          object.material = Array.isArray(object.material) ? materials : materials[0];
        });
        renderer.setRenderTarget(guide); renderer.render(scene, camera);
      } finally {
        for (const [object, material, isVisible] of saved) { object.material = material; object.visible = isVisible; }
        renderer.setRenderTarget(previous);
      }
      uniforms.guide.value = guide.texture; uniforms.normals.value = getNormals();
    },
    render(texture) {
      const previous = renderer.getRenderTarget();
      uniforms.image.value = texture;
      for (let i = 0; i < 4; i++) {
        uniforms.stepSize.value = 2 ** i; uniforms.firstPass.value = i === 0; uniforms.finalPass.value = i === 3;
        renderer.setRenderTarget(i === 3 ? null : targets[i % 2]);
        quad.render(renderer);
        if (i !== 3) uniforms.image.value = targets[i % 2].texture;
      }
      renderer.setRenderTarget(previous);
    },
    dispose() { guide.dispose(); basicMaterials.forEach(m => m.dispose()); targets.forEach(t => t.dispose()); material.dispose(); quad.dispose(); },
  };
}
