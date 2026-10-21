// GPS jamming, daily: where aircraft reported low navigation accuracy yesterday.
//
//   node jam.mjs <traces dir> <YYYY-MM-DD> <out.json>
//
// Reads one day of adsb.lol's open archive (readsb trace files, ODbL 1.0) and
// writes the 0.5-degree squares where enough aircraft reported degraded GPS.
// No dependencies: Node 22 or later.
//
// Method, part by part (each part's source is named; none of it is validated
// against known interference events):
//   - Which reports count as degraded (the God's Eye View classifier
//     "gev-nic-nacp-v2", MIT, itself based on the US 14 CFR 91.227(c) ADS-B Out
//     minima): NACp below 8, or NIC below 7 except "unknown" NIC 0 with NACp 10
//     or more, or the receiver's gpsOkBefore flag. Only ADS-B versions 1 and 2
//     (readsb decodes their quality fields as such), and only ADS-B or MLAT
//     positions (MLAT can take over once an aircraft loses GPS).
//   - How a square is scored (gpsjam.org's published formula and bands):
//     percent = 100 * (bad aircraft - 1) / all aircraft, over the day;
//     2 to 10 percent = medium, above 10 = high. An aircraft is bad in a square
//     if any of its qualifying reports there was degraded.
//   - Square size and floor (God's Eye View): 0.5 degrees, at least 3 aircraft.
// Low reported accuracy is what the data shows. Jamming or spoofing is a common
// cause but not the only one (old transponders, avionics faults).

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

export const NIC_THRESHOLD = 7
export const NACP_THRESHOLD = 8
export const CELL_DEG = 0.5
export const MIN_AIRCRAFT = 3
export const MEDIUM_PERCENT = 2
export const HIGH_PERCENT = 10
/** A trace carries the quality fields only now and then: they stay current this long. */
export const QUALITY_MAX_AGE_S = 120
const QUALIFYING_TYPES = new Set(['adsb_icao', 'mlat'])
const QUALIFYING_VERSIONS = new Set([1, 2])

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** Is one quality report degraded (the gev-nic-nacp-v2 rule)? */
export function degraded({ nic, nacp, gpsLost }) {
  if (gpsLost) return true
  if (finite(nacp) && nacp < NACP_THRESHOLD) return true
  if (finite(nic) && nic < NIC_THRESHOLD && !(nic === 0 && finite(nacp) && nacp >= 10)) return true
  return false
}

export function cellOf(lat, lon) {
  return `${Math.floor(lat / CELL_DEG)}:${Math.floor(lon / CELL_DEG)}`
}

/**
 * Add one aircraft's day (a readsb trace file) to `cells`: Map cell -> Map hex -> bad?
 * Trace points are [seconds after timestamp, lat, lon, alt, gs, track, flags,
 * vrate, details | null, source type, ...] (readsb README-json.md, "trace jsons").
 */
export function addTrace(trace, cells) {
  const hex = trace?.icao
  if (typeof hex !== 'string' || !Array.isArray(trace.trace)) return
  let quality = null
  for (const point of trace.trace) {
    if (!Array.isArray(point)) continue
    const [t, lat, lon] = point
    const details = point[8]
    if (details && typeof details === 'object') {
      quality = {
        at: t,
        nic: finite(details.nic) ? details.nic : null,
        nacp: finite(details.nac_p) ? details.nac_p : null,
        version: details.version,
        gpsLost: details.gpsOkBefore != null,
      }
    }
    if (!finite(lat) || !finite(lon) || !quality || !finite(t)) continue
    if (t - quality.at > QUALITY_MAX_AGE_S) continue
    if (!QUALIFYING_TYPES.has(point[9]) || !QUALIFYING_VERSIONS.has(quality.version)) continue
    if (quality.nic === null && quality.nacp === null && !quality.gpsLost) continue
    const key = cellOf(lat, lon)
    let aircraft = cells.get(key)
    if (!aircraft) cells.set(key, (aircraft = new Map()))
    if (degraded(quality)) aircraft.set(hex, true)
    else if (!aircraft.has(hex)) aircraft.set(hex, false)
  }
}

/** The squares worth showing: enough aircraft, and at least the medium band. */
export function score(cells) {
  const out = []
  for (const [key, aircraft] of cells) {
    const total = aircraft.size
    if (total < MIN_AIRCRAFT) continue
    let bad = 0
    for (const isBad of aircraft.values()) if (isBad) bad++
    const percent = (100 * Math.max(0, bad - 1)) / total
    if (percent < MEDIUM_PERCENT) continue
    const [y, x] = key.split(':').map(Number)
    out.push({
      south: y * CELL_DEG,
      west: x * CELL_DEG,
      percent: Math.round(percent * 10) / 10,
      aircraft: total,
      bad,
      level: percent > HIGH_PERCENT ? 'high' : 'medium',
    })
  }
  return out.sort((a, b) => b.percent - a.percent)
}

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* files(path)
    else if (entry.isFile() && entry.name.endsWith('.json')) yield path
  }
}

function readTrace(path) {
  const raw = readFileSync(path)
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw
  return JSON.parse(text.toString('utf8'))
}

function main() {
  const [dir, date, outFile] = process.argv.slice(2)
  if (!dir || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !outFile) {
    console.error('usage: node jam.mjs <traces dir> <YYYY-MM-DD> <out.json>')
    process.exit(2)
  }
  const cells = new Map()
  let traces = 0
  let unreadable = 0
  for (const path of files(dir)) {
    try {
      addTrace(readTrace(path), cells)
      traces++
    } catch {
      unreadable++
    }
  }
  const squares = score(cells)
  const result = {
    date,
    generatedAt: new Date().toISOString(),
    source: 'adsb.lol open data, readsb-prod-0 daily release (ODbL 1.0, https://www.adsb.lol/docs/open-data/historical)',
    license: 'ODbL 1.0 (a derived database of adsb.lol data)',
    method: {
      classifier: 'gev-nic-nacp-v2 (God\'s Eye View, MIT): NACp < 8, or NIC < 7 except NIC 0 with NACp >= 10, or gpsOkBefore; ADS-B v1/v2; adsb_icao or mlat positions',
      aggregation: 'gpsjam.org: percent = 100 * (bad - 1) / aircraft per square per day; medium 2-10, high > 10',
      cellDegrees: CELL_DEG,
      minAircraft: MIN_AIRCRAFT,
      meaning: 'Aircraft reported low navigation accuracy. GPS jamming or spoofing is a common cause, not the only one.',
    },
    stats: { traces, unreadable, squaresWithData: cells.size, squaresShown: squares.length },
    squares,
  }
  writeFileSync(outFile, `${JSON.stringify(result)}\n`)
  console.log(`${date}: ${traces} traces (${unreadable} unreadable), ${cells.size} squares with data, ${squares.length} shown`)
  if (traces === 0) process.exit(1)
}

// Run as a script (`node jam.mjs ...`), not when the tests import it.
if (process.argv[1]?.endsWith('jam.mjs')) main()
