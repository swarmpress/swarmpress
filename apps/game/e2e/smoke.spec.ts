import { expect, test, type Page } from '@playwright/test'

type SimpressHandle = { renderer: string; sim: { step(): bigint } }

// SwiftShader's WebGPU cannot copy canvas-backed text textures; real GPUs
// can. This is the only error tolerated, and only in the webgpu project.
const SWIFTSHADER_TEXT_UPLOAD = /copyExternalImageToTexture/

async function boot(page: Page, path: string) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(path)
  await expect(page.locator('#stage canvas')).toBeVisible()
  await page.waitForFunction(() => {
    const h = (window as unknown as { __simpress?: SimpressHandle }).__simpress
    return !!h && h.sim.step() > 5n
  })
  const renderer = await page.evaluate(
    () => (window as unknown as { __simpress: SimpressHandle }).__simpress.renderer,
  )
  return { errors, renderer }
}

test('boots the wasm sim with the preferred renderer', async ({ page }, info) => {
  const { errors, renderer } = await boot(page, '/')
  if (info.project.name === 'webgpu') {
    expect(renderer).toBe('webgpu')
    expect(errors.filter((e) => !SWIFTSHADER_TEXT_UPLOAD.test(e))).toEqual([])
  } else {
    expect(renderer).toBe('webgl')
    expect(errors).toEqual([])
  }
})

test('?renderer=webgl forces WebGL', async ({ page }, info) => {
  test.skip(info.project.name !== 'fallback', 'one run is enough')
  const { errors, renderer } = await boot(page, '/?renderer=webgl')
  expect(renderer).toBe('webgl')
  expect(errors).toEqual([])
})
