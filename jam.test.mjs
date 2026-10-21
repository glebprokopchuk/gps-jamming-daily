// node --test
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addTrace, cellOf, degraded, score } from './jam.mjs'

const details = (q) => ({ version: 2, nic: 8, nac_p: 10, ...q })
// [t, lat, lon, alt, gs, track, flags, vrate, details, type]
const point = (t, lat, lon, d = null, type = 'adsb_icao') => [t, lat, lon, 30000, 450, 90, 0, 0, d, type]

test('the gev-nic-nacp-v2 rule', () => {
  assert.equal(degraded({ nic: 8, nacp: 10 }), false)
  assert.equal(degraded({ nic: 8, nacp: 7 }), true) // NACp below 8
  assert.equal(degraded({ nic: 6, nacp: 9 }), true) // NIC below 7
  assert.equal(degraded({ nic: 0, nacp: 10 }), false) // unknown NIC with good NACp
  assert.equal(degraded({ nic: 0, nacp: 9 }), true)
  assert.equal(degraded({ nic: 8, nacp: 10, gpsLost: true }), true)
})

test('carries a quality report forward for two minutes, then stops', () => {
  const cells = new Map()
  addTrace({ icao: 'aaa111', trace: [point(0, 10.1, 20.1, details({ nac_p: 5 })), point(60, 10.2, 20.2), point(400, 30.1, 40.1)] }, cells)
  assert.deepEqual([...cells.keys()], [cellOf(10.1, 20.1)])
  assert.equal(cells.get(cellOf(10.1, 20.1)).get('aaa111'), true)
})

test('ignores version 0 transponders and positions from other sources', () => {
  const cells = new Map()
  addTrace({ icao: 'v0', trace: [point(0, 1, 1, details({ version: 0, nac_p: 0 }))] }, cells)
  addTrace({ icao: 'tisb', trace: [point(0, 1, 1, details({ nac_p: 0 }), 'tisb_icao')] }, cells)
  assert.equal(cells.size, 0)
})

test("scores a square with gpsjam.org's formula and bands", () => {
  const cells = new Map()
  // 20 aircraft through one square, 4 of them degraded: (4 - 1) / 20 = 15% -> high.
  for (let i = 0; i < 20; i++) {
    addTrace({ icao: `a${i}`, trace: [point(0, 55.2, 20.3, details(i < 4 ? { nac_p: 3 } : {}))] }, cells)
  }
  const [square] = score(cells)
  assert.deepEqual(square, { south: 55, west: 20, percent: 15, aircraft: 20, bad: 4, level: 'high' })
})

test('one bad aircraft alone never shows (the minus one), and sparse squares are hidden', () => {
  const cells = new Map()
  for (let i = 0; i < 10; i++) addTrace({ icao: `b${i}`, trace: [point(0, 1.1, 1.1, details(i === 0 ? { nac_p: 0 } : {}))] }, cells)
  addTrace({ icao: 'lonely1', trace: [point(0, 5.1, 5.1, details({ nac_p: 0 }))] }, cells)
  addTrace({ icao: 'lonely2', trace: [point(0, 5.1, 5.1, details({ nac_p: 0 }))] }, cells)
  assert.deepEqual(score(cells), [])
})

test('counts an aircraft once per square, bad if any of its reports there was', () => {
  const cells = new Map()
  addTrace({ icao: 'c1', trace: [point(0, 1.1, 1.1, details()), point(10, 1.2, 1.2, details({ nac_p: 2 })), point(20, 1.3, 1.3, details())] }, cells)
  assert.equal(cells.get(cellOf(1.1, 1.1)).size, 1)
  assert.equal(cells.get(cellOf(1.1, 1.1)).get('c1'), true)
})
