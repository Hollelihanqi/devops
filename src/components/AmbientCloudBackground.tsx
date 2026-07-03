import { useEffect, useRef } from 'react'

type Rgb = readonly [number, number, number]

type Cloud = {
  baseX: number
  baseY: number
  radius: number
  scaleX: number
  scaleY: number
  driftX: number
  driftY: number
  phase: number
  speed: number
  colorSpeed: number
  alpha: number
  colors: readonly Rgb[]
}

const palette = {
  sun: [255, 222, 68] as const,
  lime: [155, 238, 121] as const,
  mint: [119, 232, 190] as const,
  cyan: [82, 213, 235] as const,
  sky: [131, 199, 255] as const,
  lilac: [190, 199, 255] as const,
  blush: [255, 190, 222] as const,
}

const clouds: Cloud[] = [
  {
    baseX: 0.04,
    baseY: 0.1,
    radius: 0.32,
    scaleX: 1.65,
    scaleY: 0.78,
    driftX: 0.24,
    driftY: 0.08,
    phase: 0.2,
    speed: 0.32,
    colorSpeed: 0.72,
    alpha: 0.82,
    colors: [palette.sun, palette.lime, palette.mint, palette.sun],
  },
  {
    baseX: 0.62,
    baseY: 0.08,
    radius: 0.35,
    scaleX: 1.85,
    scaleY: 0.82,
    driftX: 0.22,
    driftY: 0.1,
    phase: 1.4,
    speed: 0.3,
    colorSpeed: 0.66,
    alpha: 0.76,
    colors: [palette.cyan, palette.sky, palette.mint, palette.cyan],
  },
  {
    baseX: 0.33,
    baseY: 0.34,
    radius: 0.28,
    scaleX: 1.55,
    scaleY: 0.9,
    driftX: 0.18,
    driftY: 0.12,
    phase: 2.8,
    speed: 0.27,
    colorSpeed: 0.7,
    alpha: 0.58,
    colors: [palette.lime, palette.sun, palette.blush, palette.mint],
  },
  {
    baseX: 0.92,
    baseY: 0.26,
    radius: 0.3,
    scaleX: 1.58,
    scaleY: 0.98,
    driftX: 0.16,
    driftY: 0.1,
    phase: 4.1,
    speed: 0.24,
    colorSpeed: 0.64,
    alpha: 0.52,
    colors: [palette.sky, palette.lilac, palette.cyan, palette.sky],
  },
  {
    baseX: 0.14,
    baseY: 0.5,
    radius: 0.22,
    scaleX: 1.7,
    scaleY: 0.74,
    driftX: 0.14,
    driftY: 0.08,
    phase: 5.3,
    speed: 0.22,
    colorSpeed: 0.58,
    alpha: 0.36,
    colors: [palette.sun, palette.blush, palette.lime, palette.sun],
  },
  {
    baseX: 0.72,
    baseY: 0.46,
    radius: 0.24,
    scaleX: 1.7,
    scaleY: 0.76,
    driftX: 0.16,
    driftY: 0.08,
    phase: 6.1,
    speed: 0.2,
    colorSpeed: 0.54,
    alpha: 0.36,
    colors: [palette.mint, palette.cyan, palette.sky, palette.lime],
  },
]

const wisps = Array.from({ length: 18 }, (_, index) => ({
  baseX: ((index * 0.173) % 1) * 1.08 - 0.04,
  baseY: 0.06 + ((index * 0.097) % 0.5),
  radius: 0.075 + (index % 5) * 0.018,
  phase: index * 0.74,
  alpha: 0.08 + (index % 4) * 0.015,
  color: [palette.mint, palette.cyan, palette.sun, palette.sky, palette.blush][index % 5],
}))

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ]
}

function colorFromStops(colors: readonly Rgb[], time: number) {
  const cycle = ((Math.sin(time) + 1) / 2) * (colors.length - 1)
  const index = Math.min(colors.length - 2, Math.floor(cycle))
  const amount = cycle - index
  const [r, g, b] = mix(colors[index], colors[index + 1], amount)
  return `${r}, ${g}, ${b}`
}

function makeNoisePattern(ctx: CanvasRenderingContext2D) {
  const size = 128
  const canvas = document.createElement('canvas')
  const noiseCtx = canvas.getContext('2d')
  if (!noiseCtx) return null

  canvas.width = size
  canvas.height = size
  const image = noiseCtx.createImageData(size, size)

  for (let i = 0; i < image.data.length; i += 4) {
    const value = Math.random() * 255
    image.data[i] = value
    image.data[i + 1] = value
    image.data[i + 2] = value
    image.data[i + 3] = 16
  }

  noiseCtx.putImageData(image, 0, 0)
  return ctx.createPattern(canvas, 'repeat')
}

function drawCloud(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  scaleX: number,
  scaleY: number,
  rotation: number,
  color: string,
  alpha: number,
) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rotation)
  ctx.scale(scaleX, scaleY)

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
  gradient.addColorStop(0, `rgba(${color}, ${alpha})`)
  gradient.addColorStop(0.38, `rgba(${color}, ${alpha * 0.58})`)
  gradient.addColorStop(0.72, `rgba(${color}, ${alpha * 0.18})`)
  gradient.addColorStop(1, `rgba(${color}, 0)`)

  ctx.fillStyle = gradient
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2)
  ctx.restore()
}

export default function AmbientCloudBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d', { alpha: true })
    if (!canvas || !ctx) return

    let animationFrame = 0
    let width = 0
    let height = 0
    let dpr = 1
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const noisePattern = makeNoisePattern(ctx)

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      dpr = Math.min(window.devicePixelRatio || 1, 1.6)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const draw = (timestamp: number) => {
      const time = timestamp / 1000
      const stage = Math.max(width, height)

      ctx.clearRect(0, 0, width, height)

      const topA = colorFromStops([palette.sun, palette.lime, palette.mint, palette.cyan], time * 0.2)
      const topB = colorFromStops([palette.sky, palette.cyan, palette.lilac, palette.mint], time * 0.18 + 1.1)
      const base = ctx.createLinearGradient(0, 0, width, height)
      base.addColorStop(0, `rgba(${topA}, 0.42)`)
      base.addColorStop(0.38, `rgba(${topB}, 0.32)`)
      base.addColorStop(0.72, 'rgba(255, 255, 255, 0.72)')
      base.addColorStop(1, '#ffffff')
      ctx.fillStyle = base
      ctx.fillRect(0, 0, width, height)

      ctx.globalCompositeOperation = 'source-over'
      for (const cloud of clouds) {
        const driftTime = time * cloud.speed + cloud.phase
        const x =
          (cloud.baseX +
            Math.sin(driftTime * 1.4) * cloud.driftX +
            Math.cos(driftTime * 0.8) * cloud.driftX * 0.5) *
          width
        const y =
          (cloud.baseY +
            Math.cos(driftTime * 1.1) * cloud.driftY +
            Math.sin(driftTime * 0.62) * cloud.driftY * 0.65) *
          height
        const pulse = 1 + Math.sin(driftTime * 1.7) * 0.12
        const radius = stage * cloud.radius * pulse
        const color = colorFromStops(cloud.colors, time * cloud.colorSpeed + cloud.phase)
        const rotation = Math.sin(driftTime * 0.7) * 0.35

        drawCloud(
          ctx,
          x,
          y,
          radius,
          cloud.scaleX + Math.sin(driftTime) * 0.12,
          cloud.scaleY + Math.cos(driftTime * 1.2) * 0.08,
          rotation,
          color,
          cloud.alpha,
        )
      }

      for (const wisp of wisps) {
        const drift = time * (0.1 + (wisp.phase % 0.08)) + wisp.phase
        const x = (wisp.baseX + Math.sin(drift * 1.7) * 0.08) * width
        const y = (wisp.baseY + Math.cos(drift * 1.3) * 0.055) * height
        const [r, g, b] = wisp.color
        drawCloud(
          ctx,
          x,
          y,
          stage * wisp.radius,
          2.2,
          0.65,
          Math.sin(drift) * 0.6,
          `${r}, ${g}, ${b}`,
          wisp.alpha,
        )
      }

      const veil = ctx.createLinearGradient(0, height * 0.18, 0, height)
      veil.addColorStop(0, 'rgba(255, 255, 255, 0)')
      veil.addColorStop(0.62, 'rgba(255, 255, 255, 0.34)')
      veil.addColorStop(0.88, 'rgba(255, 255, 255, 0.82)')
      veil.addColorStop(1, 'rgba(255, 255, 255, 0.98)')
      ctx.fillStyle = veil
      ctx.fillRect(0, 0, width, height)

      if (noisePattern) {
        ctx.globalAlpha = 0.028
        ctx.fillStyle = noisePattern
        ctx.fillRect(Math.sin(time * 0.12) * 24, Math.cos(time * 0.1) * 24, width, height)
        ctx.globalAlpha = 1
      }

      if (!reducedMotion.matches) {
        animationFrame = requestAnimationFrame(draw)
      }
    }

    resize()
    draw(0)
    window.addEventListener('resize', resize)

    if (!reducedMotion.matches) {
      animationFrame = requestAnimationFrame(draw)
    }

    return () => {
      cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div className="ambient-cloud-background" aria-hidden="true">
      <canvas ref={canvasRef} className="ambient-cloud-background__canvas" />
    </div>
  )
}
