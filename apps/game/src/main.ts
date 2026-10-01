import { Application, Container, Graphics, Text } from 'pixi.js'
import init, { Sim, version } from 'swarm-wasm'
import { TILE_H, TILE_W, tileToScreen } from './iso'

async function main() {
  await init()

  const app = new Application()
  const forceWebgl = new URLSearchParams(location.search).get('renderer') === 'webgl'
  await app.init({
    preference: forceWebgl ? 'webgl' : 'webgpu',
    background: '#1b1f2a',
    resizeTo: window,
    antialias: true,
  })
  document.getElementById('stage')!.appendChild(app.canvas)

  const world = new Container()
  app.stage.addChild(world)

  const tile = new Graphics()
    .poly([0, -TILE_H / 2, TILE_W / 2, 0, 0, TILE_H / 2, -TILE_W / 2, 0])
    .fill(0x3d8f6a)
    .stroke({ width: 2, color: 0x9fe0bf })
  const pos = tileToScreen(0, 0)
  tile.position.set(pos.x, pos.y)
  world.addChild(tile)

  const sim = new Sim(42n)
  const renderer = app.renderer.name
  const label = new Text({
    text: '',
    style: { fill: 0xe8e6e3, fontSize: 14, fontFamily: 'system-ui' },
  })
  label.position.set(12, 12)
  app.stage.addChild(label)

  const center = () => world.position.set(app.screen.width / 2, app.screen.height / 2)
  center()
  app.renderer.on('resize', center)

  // Fixed 100 ms simulation step, independent of frame rate.
  let acc = 0
  app.ticker.add((t) => {
    acc += t.deltaMS
    while (acc >= 100) {
      sim.tick()
      acc -= 100
    }
    label.text = `${version()} · renderer: ${renderer} · step ${sim.step()}`
  })

  ;(window as unknown as { __simpress: unknown }).__simpress = { app, sim, renderer }
}

main()
