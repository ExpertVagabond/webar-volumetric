/**
 * Volumetric Video Showcase — chroma-key video on billboard plane.
 * Uses the ChromaKeyShader from webar-core (inlined for standalone build).
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// ── ChromaKey Shader (from webar-core) ──
const chromaKeyVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const chromaKeyFragmentShader = `
  uniform sampler2D tex;
  uniform vec3 keyColor;
  uniform float similarity;
  uniform float smoothness;
  uniform float spill;
  varying vec2 vUv;

  vec2 RGBtoUV(vec3 rgb) {
    return vec2(
      rgb.r * -0.169 + rgb.g * -0.331 + rgb.b * 0.5 + 0.5,
      rgb.r * 0.5 + rgb.g * -0.419 + rgb.b * -0.081 + 0.5
    );
  }

  void main() {
    vec4 rgba = texture2D(tex, vUv);
    float chromaDist = distance(RGBtoUV(rgba.rgb), RGBtoUV(keyColor));
    float baseMask = chromaDist - similarity;
    float fullMask = pow(clamp(baseMask / smoothness, 0.0, 1.0), 1.5);
    rgba.a = fullMask;
    float spillVal = pow(clamp(baseMask / spill, 0.0, 1.0), 1.5);
    float desat = clamp(rgba.r * 0.2126 + rgba.g * 0.7152 + rgba.b * 0.0722, 0.0, 1.0);
    rgba.rgb = mix(vec3(desat), rgba.rgb, spillVal);
    gl_FragColor = rgba;
  }
`

// ── Config ──
const DEMO_VIDEOS = [
  {
    name: 'Green Screen Demo',
    url: 'https://www.w3schools.com/html/mov_bbb.mp4',
    keyColor: [0, 1, 0],
    useChromaKey: false, // This demo video has no green screen
  },
]

// ── App State ──
let renderer, scene, camera, controls, videoMesh, videoEl, playing = false

function init() {
  const container = document.getElementById('viewer')

  // Renderer
  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  container.appendChild(renderer.domElement)

  // Scene
  scene = new THREE.Scene()

  // Camera
  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100)
  camera.position.set(0, 1, 3)

  // Controls
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.target.set(0, 0.8, 0)

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const dir = new THREE.DirectionalLight(0xffffff, 1)
  dir.position.set(2, 3, 2)
  scene.add(dir)

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x111119, roughness: 0.9 })
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)

  const grid = new THREE.GridHelper(10, 20, 0x333366, 0x1a1a2e)
  grid.material.opacity = 0.3
  grid.material.transparent = true
  scene.add(grid)

  // Pedestal ring (glow effect)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.5, 0.02, 16, 64),
    new THREE.MeshBasicMaterial({ color: 0x7611b7 })
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.01
  scene.add(ring)

  // Video element
  videoEl = document.createElement('video')
  videoEl.crossOrigin = 'anonymous'
  videoEl.loop = true
  videoEl.muted = true
  videoEl.playsInline = true
  videoEl.src = DEMO_VIDEOS[0].url

  const videoTexture = new THREE.VideoTexture(videoEl)
  videoTexture.minFilter = THREE.LinearFilter
  videoTexture.magFilter = THREE.LinearFilter

  // Video billboard (always faces camera via lookAt in tick)
  const aspect = 16 / 9
  const height = 1.5
  const width = height * aspect

  const material = DEMO_VIDEOS[0].useChromaKey
    ? new THREE.ShaderMaterial({
        uniforms: {
          tex: { value: videoTexture },
          keyColor: { value: new THREE.Color(...DEMO_VIDEOS[0].keyColor) },
          similarity: { value: 0.4 },
          smoothness: { value: 0.08 },
          spill: { value: 0.1 },
        },
        vertexShader: chromaKeyVertexShader,
        fragmentShader: chromaKeyFragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
      })
    : new THREE.MeshBasicMaterial({ map: videoTexture, side: THREE.DoubleSide })

  videoMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
  videoMesh.position.set(0, height / 2 + 0.1, 0)
  scene.add(videoMesh)

  // Controls
  document.getElementById('play-btn').onclick = togglePlay
  document.getElementById('mute-btn').onclick = toggleMute

  // Chroma key controls
  document.getElementById('similarity').oninput = (e) => {
    if (videoMesh.material.uniforms) {
      videoMesh.material.uniforms.similarity.value = parseFloat(e.target.value)
    }
  }
  document.getElementById('smoothness').oninput = (e) => {
    if (videoMesh.material.uniforms) {
      videoMesh.material.uniforms.smoothness.value = parseFloat(e.target.value)
    }
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  animate()
}

function togglePlay() {
  if (playing) {
    videoEl.pause()
    document.getElementById('play-btn').textContent = '▶ Play'
  } else {
    videoEl.play()
    document.getElementById('play-btn').textContent = '⏸ Pause'
  }
  playing = !playing
}

function toggleMute() {
  videoEl.muted = !videoEl.muted
  document.getElementById('mute-btn').textContent = videoEl.muted ? '🔇' : '🔊'
}

function animate() {
  requestAnimationFrame(animate)
  controls.update()

  // Billboard: face camera (Y-axis only)
  if (videoMesh) {
    videoMesh.lookAt(camera.position.x, videoMesh.position.y, camera.position.z)
  }

  renderer.render(scene, camera)
}

document.addEventListener('DOMContentLoaded', init)
