/**
 * Volumetric Video Showcase — chroma-key video with canvas-generated green screen demo.
 * Renders animated content on a green background, then removes the green with GLSL.
 * Shows the power of chroma-key compositing in real-time WebGL.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// ── ChromaKey Shader ──
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

let renderer, scene, camera, controls, videoMesh, clock
let sourceCanvas, sourceCtx, sourceTexture
let chromaKeyEnabled = true
let animationFrame = 0

// Demo characters to render on green screen
const DEMOS = [
  { name: 'Dancing Robot', draw: drawRobot },
  { name: 'Spinning Logo', draw: drawLogo },
  { name: 'Particle Storm', draw: drawParticles },
]
let currentDemo = 0
let aiImageLoading = false

// AI Scene Generation
const AI_SCENE_PROMPTS = [
  'holographic dancer performing in neon lights dark stage',
  'floating crystal orb with swirling energy inside dark void',
  'ethereal ghost figure glowing translucent on dark background',
  'robot DJ with turntables neon cyberpunk stage dark background',
  'phoenix bird made of fire rising dark background',
  'astronaut floating in space with stars and nebula',
  'samurai warrior with glowing sword dark misty background',
  'dragon breathing colorful fire dark fantasy background',
]
let aiPromptIndex = 0

function generateAIScene(customPrompt) {
  const prompt = customPrompt || AI_SCENE_PROMPTS[aiPromptIndex % AI_SCENE_PROMPTS.length]
  aiPromptIndex++
  const encoded = encodeURIComponent(prompt + ', centered subject, green screen background, chroma key ready, high contrast')
  return `https://image.pollinations.ai/prompt/${encoded}?width=512&height=512&seed=${Date.now()}&model=flux`
}

function init() {
  const container = document.getElementById('viewer')
  clock = new THREE.Clock()

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  container.appendChild(renderer.domElement)

  scene = new THREE.Scene()

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100)
  camera.position.set(0, 1.2, 3.5)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.target.set(0, 0.8, 0)
  controls.maxPolarAngle = Math.PI / 2 + 0.1
  controls.minDistance = 1.5
  controls.maxDistance = 8

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.4))
  const dir = new THREE.DirectionalLight(0xffffff, 0.8)
  dir.position.set(2, 3, 2)
  scene.add(dir)

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({ color: 0x111119, roughness: 0.9 })
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)

  const grid = new THREE.GridHelper(12, 24, 0x333366, 0x1a1a2e)
  grid.material.opacity = 0.2
  grid.material.transparent = true
  scene.add(grid)

  // Stage — circular platform with glow ring
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.9, 0.06, 48),
    new THREE.MeshStandardMaterial({ color: 0x1a1a2e, metalness: 0.8, roughness: 0.2 })
  )
  platform.position.y = 0.03
  scene.add(platform)

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.02, 16, 64),
    new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.6 })
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.07
  scene.add(ring)

  // Vertical light pillars
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 2.5, 8),
      new THREE.MeshBasicMaterial({ color: 0x8b5cf6, transparent: true, opacity: 0.15 })
    )
    pillar.position.set(Math.cos(angle) * 0.85, 1.3, Math.sin(angle) * 0.85)
    scene.add(pillar)
  }

  // Canvas-based green screen source
  sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = 512
  sourceCanvas.height = 512
  sourceCtx = sourceCanvas.getContext('2d')

  sourceTexture = new THREE.CanvasTexture(sourceCanvas)
  sourceTexture.minFilter = THREE.LinearFilter
  sourceTexture.magFilter = THREE.LinearFilter

  // Video billboard with chroma-key shader
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tex: { value: sourceTexture },
      keyColor: { value: new THREE.Color(0, 1, 0) },
      similarity: { value: 0.3 },
      smoothness: { value: 0.1 },
      spill: { value: 0.15 },
    },
    vertexShader: chromaKeyVertexShader,
    fragmentShader: chromaKeyFragmentShader,
    transparent: true,
    side: THREE.DoubleSide,
  })

  videoMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), material)
  videoMesh.position.set(0, 0.85, 0)
  scene.add(videoMesh)

  // Also show the raw source as small preview
  const previewMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.5),
    new THREE.MeshBasicMaterial({ map: sourceTexture, side: THREE.DoubleSide })
  )
  previewMesh.position.set(-2, 0.5, 0)
  previewMesh.userData.isPreview = true
  scene.add(previewMesh)

  // Label for preview
  const previewLabel = document.createElement('div')
  previewLabel.style.cssText = 'font-size:0.55rem;color:#7b7390;font-family:"JetBrains Mono",monospace;text-align:center;pointer-events:none'
  previewLabel.textContent = 'Source (green screen)'

  // Controls
  document.getElementById('toggle-chroma').onclick = () => {
    chromaKeyEnabled = !chromaKeyEnabled
    if (chromaKeyEnabled) {
      videoMesh.material = material
      document.getElementById('toggle-chroma').textContent = 'ChromaKey: ON'
    } else {
      videoMesh.material = new THREE.MeshBasicMaterial({ map: sourceTexture, side: THREE.DoubleSide })
      document.getElementById('toggle-chroma').textContent = 'ChromaKey: OFF'
    }
  }

  document.getElementById('next-demo').onclick = () => {
    currentDemo = (currentDemo + 1) % DEMOS.length
    document.getElementById('demo-name').textContent = DEMOS[currentDemo].name
  }

  document.getElementById('similarity').oninput = (e) => {
    material.uniforms.similarity.value = parseFloat(e.target.value)
  }
  document.getElementById('smoothness').oninput = (e) => {
    material.uniforms.smoothness.value = parseFloat(e.target.value)
  }

  // AI Generate button
  document.getElementById('ai-generate').onclick = async () => {
    if (aiImageLoading) return
    aiImageLoading = true
    const btn = document.getElementById('ai-generate')
    btn.textContent = 'Generating...'
    btn.style.opacity = '0.5'

    const promptInput = document.getElementById('ai-prompt')
    const customPrompt = promptInput?.value?.trim() || null

    try {
      const url = generateAIScene(customPrompt)
      const loader = new THREE.TextureLoader()
      const tex = await new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject)
      })

      // Create a new canvas to draw the AI image on green background
      const aiCanvas = document.createElement('canvas')
      aiCanvas.width = 512
      aiCanvas.height = 512
      const aiCtx = aiCanvas.getContext('2d')

      // Draw the AI image
      aiCtx.drawImage(tex.image, 0, 0, 512, 512)
      const aiTexture = new THREE.CanvasTexture(aiCanvas)
      aiTexture.minFilter = THREE.LinearFilter

      // Replace the video mesh texture
      material.uniforms.tex.value = aiTexture
      material.uniforms.tex.value.needsUpdate = true

      // Also update the preview mesh
      scene.traverse((obj) => {
        if (obj.userData?.isPreview) {
          obj.material.map = aiTexture
          obj.material.needsUpdate = true
        }
      })

      // Add AI draw to demo list
      DEMOS.push({
        name: 'AI: ' + (customPrompt || AI_SCENE_PROMPTS[(aiPromptIndex - 1) % AI_SCENE_PROMPTS.length]).substring(0, 25),
        draw: (ctx, w, h, t) => {
          ctx.drawImage(tex.image, 0, 0, w, h)
        },
      })
      currentDemo = DEMOS.length - 1
      document.getElementById('demo-name').textContent = DEMOS[currentDemo].name

      // Reset source texture reference
      sourceTexture = aiTexture

      showToast('AI scene loaded!')
    } catch (err) {
      console.error('AI generation failed:', err)
      showToast('AI generation failed — try again')
    } finally {
      aiImageLoading = false
      btn.textContent = '🤖 AI Generate'
      btn.style.opacity = '1'
    }
  }

  // AR Camera mode
  document.getElementById('ar-camera').onclick = async () => {
    const btn = document.getElementById('ar-camera')
    if (btn.dataset.active === 'true') {
      // Stop AR
      if (window._arStream) {
        window._arStream.getTracks().forEach((t) => t.stop())
        window._arStream = null
      }
      const vid = document.getElementById('ar-video')
      if (vid) vid.remove()
      renderer.setClearColor(0x08080f, 1)
      scene.traverse((obj) => {
        if (obj.isGridHelper) obj.visible = true
      })
      btn.dataset.active = 'false'
      btn.textContent = '📷 AR Mode'
      btn.classList.remove('active')
      showToast('AR mode off')
    } else {
      // Start AR
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 } },
        })
        window._arStream = stream
        const vid = document.createElement('video')
        vid.id = 'ar-video'
        vid.srcObject = stream
        vid.setAttribute('playsinline', '')
        vid.setAttribute('autoplay', '')
        vid.muted = true
        vid.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1;'
        document.body.insertBefore(vid, document.body.firstChild)
        await vid.play()
        renderer.setClearColor(0x000000, 0)
        scene.traverse((obj) => {
          if (obj.isGridHelper) obj.visible = false
        })
        btn.dataset.active = 'true'
        btn.textContent = '📱 3D View'
        btn.classList.add('active')
        showToast('AR Camera active — content overlays your view')
      } catch (err) {
        showToast('Camera access denied')
      }
    }
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  })

  animate()
}

// ── Canvas Drawing Functions (simulate green screen content) ──

function drawRobot(ctx, w, h, t) {
  // Green background
  ctx.fillStyle = '#00ff00'
  ctx.fillRect(0, 0, w, h)

  const cx = w / 2
  const cy = h / 2

  // Body sway
  const sway = Math.sin(t * 3) * 15

  ctx.save()
  ctx.translate(cx + sway, cy + 30)

  // Body
  ctx.fillStyle = '#4466ff'
  ctx.fillRect(-40, -30, 80, 80)

  // Head
  ctx.fillStyle = '#5577ff'
  ctx.fillRect(-30, -70, 60, 45)

  // Eyes
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(-20, -60, 15, 15)
  ctx.fillRect(5, -60, 15, 15)
  // Pupils (follow a pattern)
  ctx.fillStyle = '#000000'
  const px = Math.sin(t * 2) * 4
  ctx.fillRect(-16 + px, -56, 7, 7)
  ctx.fillRect(9 + px, -56, 7, 7)

  // Mouth (opens and closes)
  ctx.fillStyle = '#ff4466'
  const mouthH = 3 + Math.abs(Math.sin(t * 4)) * 8
  ctx.fillRect(-15, -42, 30, mouthH)

  // Arms
  const armAngle = Math.sin(t * 2.5) * 30
  ctx.save()
  ctx.translate(-40, -10)
  ctx.rotate(armAngle * Math.PI / 180)
  ctx.fillStyle = '#4466ff'
  ctx.fillRect(-8, 0, 16, 50)
  ctx.fillStyle = '#cccccc'
  ctx.beginPath()
  ctx.arc(0, 55, 10, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  ctx.save()
  ctx.translate(40, -10)
  ctx.rotate(-armAngle * Math.PI / 180)
  ctx.fillStyle = '#4466ff'
  ctx.fillRect(-8, 0, 16, 50)
  ctx.fillStyle = '#cccccc'
  ctx.beginPath()
  ctx.arc(0, 55, 10, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Legs (walking motion)
  const legAngle = Math.sin(t * 3) * 20
  ctx.save()
  ctx.translate(-20, 50)
  ctx.rotate(legAngle * Math.PI / 180)
  ctx.fillStyle = '#3355cc'
  ctx.fillRect(-8, 0, 16, 50)
  ctx.restore()
  ctx.save()
  ctx.translate(20, 50)
  ctx.rotate(-legAngle * Math.PI / 180)
  ctx.fillStyle = '#3355cc'
  ctx.fillRect(-8, 0, 16, 50)
  ctx.restore()

  // Antenna
  ctx.strokeStyle = '#cccccc'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, -70)
  ctx.lineTo(Math.sin(t * 5) * 10, -90)
  ctx.stroke()
  ctx.fillStyle = '#ff4466'
  ctx.beginPath()
  ctx.arc(Math.sin(t * 5) * 10, -93, 5, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

function drawLogo(ctx, w, h, t) {
  ctx.fillStyle = '#00ff00'
  ctx.fillRect(0, 0, w, h)

  const cx = w / 2
  const cy = h / 2

  // Spinning hexagon
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(t * 0.5)

  const size = 80 + Math.sin(t * 2) * 20
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 2
    const x = Math.cos(angle) * size
    const y = Math.sin(angle) * size
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = '#8b5cf6'
  ctx.fill()
  ctx.strokeStyle = '#00edaf'
  ctx.lineWidth = 3
  ctx.stroke()

  // PSM text
  ctx.rotate(-t * 0.5) // counter-rotate text
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 36px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('PSM', 0, 0)

  ctx.font = '12px sans-serif'
  ctx.fillStyle = '#00edaf'
  ctx.fillText('Purple Squirrel Media', 0, 25)

  ctx.restore()

  // Orbiting circles
  for (let i = 0; i < 5; i++) {
    const angle = t * 1.5 + (i / 5) * Math.PI * 2
    const r = 120
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    ctx.beginPath()
    ctx.arc(x, y, 8, 0, Math.PI * 2)
    ctx.fillStyle = ['#00edaf', '#00b5ad', '#8b5cf6', '#ff4466', '#ffc828'][i]
    ctx.fill()
  }
}

function drawParticles(ctx, w, h, t) {
  ctx.fillStyle = '#00ff00'
  ctx.fillRect(0, 0, w, h)

  const cx = w / 2
  const cy = h / 2

  // Particle burst
  for (let i = 0; i < 60; i++) {
    const seed = i * 137.508
    const angle = seed + t * (0.3 + (i % 5) * 0.1)
    const r = 30 + (i * 3 + t * 40) % 200
    const x = cx + Math.cos(angle) * r
    const y = cy + Math.sin(angle) * r
    const size = 2 + Math.sin(t * 3 + i) * 2

    const colors = ['#8b5cf6', '#00edaf', '#00b5ad', '#ff4466', '#ffc828', '#ffffff']
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fillStyle = colors[i % colors.length]
    ctx.fill()
  }

  // Center glow text
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 28px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const scale = 1 + Math.sin(t * 2) * 0.1
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  ctx.fillText('VOLUMETRIC', 0, -10)
  ctx.font = '14px sans-serif'
  ctx.fillStyle = '#00edaf'
  ctx.fillText('chroma-key demo', 0, 15)
  ctx.restore()
}

function animate() {
  requestAnimationFrame(animate)
  const t = clock.getElapsedTime()
  controls.update()
  animationFrame++

  // Update canvas source (green screen content)
  DEMOS[currentDemo].draw(sourceCtx, sourceCanvas.width, sourceCanvas.height, t)
  sourceTexture.needsUpdate = true

  // Billboard: face camera (Y-axis only)
  if (videoMesh) {
    videoMesh.lookAt(camera.position.x, videoMesh.position.y, camera.position.z)
  }

  // Animate ring glow
  scene.traverse((obj) => {
    if (obj.geometry?.type === 'TorusGeometry') {
      obj.material.opacity = 0.4 + Math.sin(t * 2) * 0.2
    }
    if (obj.userData?.isPreview) {
      obj.lookAt(camera.position.x, obj.position.y, camera.position.z)
    }
  })

  renderer.render(scene, camera)
}

function showToast(msg) {
  // Remove existing toast
  let toast = document.getElementById('vol-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.id = 'vol-toast'
    toast.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:100;background:#111119;border:1px solid #00edaf;color:#eae6f2;padding:0.6rem 1.2rem;border-radius:10px;font-size:0.85rem;opacity:0;transition:all 0.3s;pointer-events:none;font-family:Outfit,sans-serif'
    document.body.appendChild(toast)
  }
  toast.textContent = msg
  toast.style.opacity = '1'
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => { toast.style.opacity = '0' }, 3000)
}

document.addEventListener('DOMContentLoaded', init)
