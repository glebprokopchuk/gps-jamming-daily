# GPS jamming, daily

Where aircraft reported low GPS accuracy yesterday, in 0.5-degree squares. One
small JSON file, rebuilt every day from open flight-tracking data:
[`data/latest.json`](data/latest.json).

Low reported accuracy is what the data shows. GPS jamming or spoofing is a
common cause, but not the only one: old transponders and faulty avionics report
low values too. Nothing here is validated against known interference events.

## Where the data comes from

[adsb.lol](https://www.adsb.lol/docs/open-data/historical) publishes one day of
the whole sky every day, from volunteer receivers. Its docs give the licence as
ODbL 1.0; the archive itself also ships a CC0 notice. We follow the stricter of
the two: this file is a derived database under **ODbL 1.0**, credited and open.

## Method

Each part is borrowed and named:

| Part | Rule | Source |
| --- | --- | --- |
| A degraded report | NACp below 8, or NIC below 7 (except "unknown" NIC 0 with NACp 10 or more), or the receiver's `gpsOkBefore` flag. ADS-B versions 1 and 2 only; ADS-B or MLAT positions | The God's Eye View classifier `gev-nic-nacp-v2` (MIT), based on the US 14 CFR 91.227(c) ADS-B Out minima |
| A square's score | `100 × (bad aircraft − 1) / all aircraft` over the day. 2–10% is medium, over 10% is high | [gpsjam.org](https://gpsjam.org/faq) |
| Square and floor | 0.5 degrees (~55 km north-south); at least 3 aircraft | God's Eye View |

An aircraft is bad in a square if any of its reports there was degraded. A
trace carries the quality fields only now and then, so each report stays current
for 2 minutes.

## Output

```json
{
  "date": "2026-10-20",
  "squares": [{ "south": 54, "west": 23, "percent": 97.2, "aircraft": 36, "bad": 36, "level": "high" }],
  "stats": { "traces": 0, "squaresWithData": 0, "squaresShown": 0 },
  "method": {},
  "source": "",
  "license": "ODbL 1.0"
}
```

Only squares at medium or high are listed. `south` / `west` are the square's
south-west corner in degrees.

## Run it

```
node --test
node jam.mjs <folder of readsb trace files> <YYYY-MM-DD> out.json
```

No dependencies (Node 22+). The daily run is in
[`.github/workflows/daily.yml`](.github/workflows/daily.yml).

Code: MIT. Data: ODbL 1.0.
