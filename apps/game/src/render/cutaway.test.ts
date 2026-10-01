import { describe, expect, it } from 'vitest'
import { ISO_ALPHAS } from './camera-math'
import { isCutAway, type Side } from './cutaway'

const visible = (alpha: number) =>
  (['north', 'south', 'east', 'west'] as Side[]).filter((s) => !isCutAway(s, alpha)).sort()

describe('cutaway', () => {
  it('from the south-east the back (north, west) walls stay', () => {
    expect(visible(ISO_ALPHAS[1])).toEqual(['north', 'west'])
  })

  it('every snapped angle keeps exactly two adjacent walls', () => {
    const expected = [
      ['south', 'west'],
      ['north', 'west'],
      ['east', 'north'],
      ['east', 'south'],
    ]
    ISO_ALPHAS.forEach((a, i) => expect(visible(a)).toEqual(expected[i]))
  })
})
