import { findPivotHighs, findPivotLows } from './doubleReversal.js'

export const DEFAULT_HEAD_SHOULDERS_OPTIONS = {
  leftBars: 3,
  rightBars: 3,
  minHeadClearance: 0.03,
  shoulderTolerance: 0.05,
  necklineTolerance: 0.05,
  /** Shoulder must clear adjacent neck pivot by this fraction */
  minShoulderRise: 0.03,
  /** Longer leg / shorter leg cap (LS→head vs head→RS) */
  maxLegAsymmetry: 2,
  minBarsLeg: 5,
  maxBarsLeg: 30,
  requireBreakoutVolume: false,
  breakoutVolumeMultiplier: 1.2,
  avgVolumePeriod: 20,
}

/** ponytail: 0.5% wick slack — same spirit as doubleReversal */
const INTERMEDIATE_WICK_SLACK = 0.005

function avgVolumeBefore(data, index, period) {
  if (index < period) return null
  let sum = 0
  for (let i = index - period; i < index; i++) {
    sum += data[i].volume ?? 0
  }
  return sum / period
}

function necklinePriceAt(n1, n2, index) {
  if (n2.index === n1.index) return n1.price
  const t = (index - n1.index) / (n2.index - n1.index)
  return n1.price + (n2.price - n1.price) * t
}

/**
 * @param {'down'|'up'} direction down = classic H&S, up = inverse
 */
function findSlopingOutcome(data, afterIndex, n1, n2, headPrice, opts, direction) {
  for (let i = afterIndex + 1; i < data.length; i++) {
    const candle = data[i]
    const neck = necklinePriceAt(n1, n2, i)
    const confirmed = direction === 'down'
      ? candle.close < neck
      : candle.close > neck

    if (!confirmed) {
      const failed = direction === 'down'
        ? candle.close > headPrice
        : candle.close < headPrice
      if (failed) return { status: 'failed', candle }
      continue
    }

    if (opts.requireBreakoutVolume) {
      const avgVol = avgVolumeBefore(data, i, opts.avgVolumePeriod)
      const volume = candle.volume ?? 0
      if (avgVol === null || volume <= avgVol * opts.breakoutVolumeMultiplier) continue
    }

    return { status: 'confirmed', candle }
  }

  return { status: 'pending', candle: undefined }
}

function breachesExtreme(data, fromIndex, toIndex, extremePrice, direction) {
  for (let i = fromIndex + 1; i < toIndex; i++) {
    if (direction === 'down') {
      if (data[i].high > extremePrice * (1 + INTERMEDIATE_WICK_SLACK)) return true
    } else if (data[i].low < extremePrice * (1 - INTERMEDIATE_WICK_SLACK)) {
      return true
    }
  }
  return false
}

function patternQuality(p) {
  const priceDiff = Math.abs(p.rs.price - p.ls.price) / p.ls.price
  return priceDiff + (p.rs.index - p.ls.index) / 1000
}

function dedupeOverlapping(patterns) {
  const ranked = [...patterns].sort((a, b) => patternQuality(a) - patternQuality(b))
  const kept = []

  for (const p of ranked) {
    const overlaps = kept.some(k =>
      p.ls.index <= k.rs.index && p.rs.index >= k.ls.index)
    if (!overlaps) kept.push(p)
  }

  return kept.sort((a, b) => a.ls.index - b.ls.index)
}

function toPricePattern(pattern) {
  const isClassic = pattern.type === 'head-shoulders'
  const path = [pattern.ls, pattern.n1, pattern.head, pattern.n2, pattern.rs]

  return {
    id: pattern.id,
    type: pattern.type,
    nameKey: isClassic ? 'patternHeadShoulders' : 'patternInverseHeadShoulders',
    status: pattern.status,
    startIndex: pattern.ls.index,
    color: isClassic ? '#ef5350' : '#26a69a',
    lines: [
      { points: path, style: 'status', width: 2 },
      {
        points: [
          { time: pattern.n1.time, price: pattern.n1.price },
          { time: pattern.n2.time, price: pattern.n2.price },
        ],
        style: 'dashed',
        width: pattern.status === 'confirmed' ? 2 : 1.5,
      },
    ],
    breakout: pattern.breakout,
    invalidated: pattern.invalidated,
  }
}

function legOk(bars, opts) {
  return bars >= opts.minBarsLeg && bars <= opts.maxBarsLeg
}

function legsAsymmetric(leftBars, rightBars, maxRatio) {
  const shorter = Math.min(leftBars, rightBars)
  if (shorter <= 0) return true
  return Math.max(leftBars, rightBars) / shorter > maxRatio
}

/** True if price undercuts floor between n2 and RS (classic) / exceeds ceiling (inverse). */
function breaksNeckBeforeRightShoulder(data, n2Index, rsIndex, neckExtreme, direction) {
  for (let i = n2Index + 1; i < rsIndex; i++) {
    if (direction === 'down') {
      if (data[i].low < neckExtreme * (1 - INTERMEDIATE_WICK_SLACK)) return true
    } else if (data[i].high > neckExtreme * (1 + INTERMEDIATE_WICK_SLACK)) {
      return true
    }
  }
  return false
}

function hasPivotBetween(pivots, fromIndex, toIndex) {
  return pivots.some(p => p.index > fromIndex && p.index < toIndex)
}

function detectClassic(data, opts) {
  const pivotHighs = findPivotHighs(data, opts.leftBars, opts.rightBars)
  const pivotLows = findPivotLows(data, opts.leftBars, opts.rightBars)
  const patterns = []
  const seenIds = new Set()

  for (let i = 0; i < pivotHighs.length; i++) {
    const ls = pivotHighs[i]

    for (let j = i + 1; j < pivotHighs.length; j++) {
      const rs = pivotHighs[j]
      if (!legOk(rs.index - ls.index, {
        minBarsLeg: opts.minBarsLeg * 2,
        maxBarsLeg: opts.maxBarsLeg * 2,
      })) continue
      if (Math.abs(rs.price - ls.price) / ls.price > opts.shoulderTolerance) continue

      const betweenHighs = pivotHighs.filter(h => h.index > ls.index && h.index < rs.index)
      if (!betweenHighs.length) continue
      const head = betweenHighs.reduce((best, h) => (h.price > best.price ? h : best))

      const leftLeg = head.index - ls.index
      const rightLeg = rs.index - head.index
      if (!legOk(leftLeg, opts) || !legOk(rightLeg, opts)) continue
      if (legsAsymmetric(leftLeg, rightLeg, opts.maxLegAsymmetry)) continue
      if (head.price < ls.price * (1 + opts.minHeadClearance)) continue
      if (head.price < rs.price * (1 + opts.minHeadClearance)) continue

      // Head must stay the extreme — no taller wick between shoulders (skip head bar)
      if (breachesExtreme(data, ls.index, head.index, head.price, 'down')) continue
      if (breachesExtreme(data, head.index, rs.index, head.price, 'down')) continue

      const leftLows = pivotLows.filter(l => l.index > ls.index && l.index < head.index)
      const rightLows = pivotLows.filter(l => l.index > head.index && l.index < rs.index)
      if (!leftLows.length || !rightLows.length) continue

      const n1 = leftLows.reduce((best, l) => (l.price < best.price ? l : best))
      const n2 = rightLows.reduce((best, l) => (l.price < best.price ? l : best))
      if (Math.abs(n2.price - n1.price) / n1.price > opts.necklineTolerance) continue
      if (ls.price < n1.price * (1 + opts.minShoulderRise)) continue
      if (rs.price < n2.price * (1 + opts.minShoulderRise)) continue
      if (breaksNeckBeforeRightShoulder(data, n2.index, rs.index, Math.min(n1.price, n2.price), 'down')) continue
      // Shoulders must sit on neckline — no skipped peak between LS→N1 or N2→RS
      if (hasPivotBetween(pivotHighs, ls.index, n1.index)) continue
      if (hasPivotBetween(pivotHighs, n2.index, rs.index)) continue

      const id = `hs-${ls.index}-${n1.index}-${head.index}-${n2.index}-${rs.index}`
      if (seenIds.has(id)) continue
      seenIds.add(id)

      const outcome = findSlopingOutcome(data, rs.index, n1, n2, head.price, opts, 'down')
      patterns.push({
        id,
        type: 'head-shoulders',
        ls,
        n1,
        head,
        n2,
        rs,
        breakout: outcome.status === 'confirmed' ? outcome.candle : undefined,
        invalidated: outcome.status === 'failed' ? outcome.candle : undefined,
        status: outcome.status,
      })
    }
  }

  return dedupeOverlapping(patterns).map(toPricePattern)
}

function detectInverse(data, opts) {
  const pivotHighs = findPivotHighs(data, opts.leftBars, opts.rightBars)
  const pivotLows = findPivotLows(data, opts.leftBars, opts.rightBars)
  const patterns = []
  const seenIds = new Set()

  for (let i = 0; i < pivotLows.length; i++) {
    const ls = pivotLows[i]

    for (let j = i + 1; j < pivotLows.length; j++) {
      const rs = pivotLows[j]
      if (!legOk(rs.index - ls.index, {
        minBarsLeg: opts.minBarsLeg * 2,
        maxBarsLeg: opts.maxBarsLeg * 2,
      })) continue
      if (Math.abs(rs.price - ls.price) / ls.price > opts.shoulderTolerance) continue

      const betweenLows = pivotLows.filter(l => l.index > ls.index && l.index < rs.index)
      if (!betweenLows.length) continue
      const head = betweenLows.reduce((best, l) => (l.price < best.price ? l : best))

      const leftLeg = head.index - ls.index
      const rightLeg = rs.index - head.index
      if (!legOk(leftLeg, opts) || !legOk(rightLeg, opts)) continue
      if (legsAsymmetric(leftLeg, rightLeg, opts.maxLegAsymmetry)) continue
      if (head.price > ls.price * (1 - opts.minHeadClearance)) continue
      if (head.price > rs.price * (1 - opts.minHeadClearance)) continue

      if (breachesExtreme(data, ls.index, head.index, head.price, 'up')) continue
      if (breachesExtreme(data, head.index, rs.index, head.price, 'up')) continue

      const leftHighs = pivotHighs.filter(h => h.index > ls.index && h.index < head.index)
      const rightHighs = pivotHighs.filter(h => h.index > head.index && h.index < rs.index)
      if (!leftHighs.length || !rightHighs.length) continue

      const n1 = leftHighs.reduce((best, h) => (h.price > best.price ? h : best))
      const n2 = rightHighs.reduce((best, h) => (h.price > best.price ? h : best))
      if (Math.abs(n2.price - n1.price) / n1.price > opts.necklineTolerance) continue
      if (ls.price > n1.price * (1 - opts.minShoulderRise)) continue
      if (rs.price > n2.price * (1 - opts.minShoulderRise)) continue
      if (breaksNeckBeforeRightShoulder(data, n2.index, rs.index, Math.max(n1.price, n2.price), 'up')) continue
      // Shoulders adjacent to neckline — no skipped trough between LS→N1 or N2→RS
      if (hasPivotBetween(pivotLows, ls.index, n1.index)) continue
      if (hasPivotBetween(pivotLows, n2.index, rs.index)) continue

      const id = `ihs-${ls.index}-${n1.index}-${head.index}-${n2.index}-${rs.index}`
      if (seenIds.has(id)) continue
      seenIds.add(id)

      const outcome = findSlopingOutcome(data, rs.index, n1, n2, head.price, opts, 'up')
      patterns.push({
        id,
        type: 'inverse-head-shoulders',
        ls,
        n1,
        head,
        n2,
        rs,
        breakout: outcome.status === 'confirmed' ? outcome.candle : undefined,
        invalidated: outcome.status === 'failed' ? outcome.candle : undefined,
        status: outcome.status,
      })
    }
  }

  return dedupeOverlapping(patterns).map(toPricePattern)
}

/** Classic head & shoulders (bearish). */
export function detectHeadShoulders(data, options = {}) {
  if (!data?.length) return []
  const opts = { ...DEFAULT_HEAD_SHOULDERS_OPTIONS, ...options }
  return detectClassic(data, opts)
}

/** Inverse head & shoulders (bullish). */
export function detectInverseHeadShoulders(data, options = {}) {
  if (!data?.length) return []
  const opts = { ...DEFAULT_HEAD_SHOULDERS_OPTIONS, ...options }
  return detectInverse(data, opts)
}
