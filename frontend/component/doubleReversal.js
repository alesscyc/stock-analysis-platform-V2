/**
 * @typedef {Object} PivotPoint
 * @property {number} index
 * @property {string|number} time
 * @property {number} price
 * @property {'high'|'low'} type
 */

/**
 * @typedef {Object} Candle
 * @property {string|number} time
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} [volume]
 */

/**
 * @typedef {Object} PricePattern
 * @property {string} id
 * @property {'double-bottom'|'double-top'} type
 * @property {'pending'|'confirmed'|'failed'} status
 * @property {number} startIndex
 * @property {string} color
 * @property {Object[]} lines
 * @property {Object[]} labels
 * @property {Candle} [breakout]
 * @property {Candle} [invalidated]
 */

/**
 * @typedef {Object} DoubleBottomOptions
 * @property {number} [leftBars]
 * @property {number} [rightBars]
 * @property {number} [bottomTolerance]
 * @property {number} [necklineThreshold]
 * @property {number} [minNecklineDecline]
 * @property {number} [minBarsBetweenBottoms]
 * @property {number} [maxBarsBetweenBottoms]
 * @property {boolean} [requireBreakoutVolume]
 * @property {number} [breakoutVolumeMultiplier]
 * @property {number} [avgVolumePeriod]
 */

export const DEFAULT_DOUBLE_BOTTOM_OPTIONS = {
  leftBars: 3,
  rightBars: 3,
  bottomTolerance: 0.03,
  necklineThreshold: 1.03,
  minNecklineDecline: 0.02,
  minBarsBetweenBottoms: 10,
  maxBarsBetweenBottoms: 80,
  requireBreakoutVolume: false,
  breakoutVolumeMultiplier: 1.2,
  avgVolumePeriod: 20,
}

export const DEFAULT_DOUBLE_TOP_OPTIONS = {
  leftBars: 3,
  rightBars: 3,
  topTolerance: 0.03,
  necklineThreshold: 1.03,
  minNecklineRise: 0.02,
  minBarsBetweenTops: 10,
  maxBarsBetweenTops: 80,
  requireBreakoutVolume: false,
  breakoutVolumeMultiplier: 1.2,
  avgVolumePeriod: 20,
}

/**
 * @param {Candle[]} data
 * @param {number} [leftBars]
 * @param {number} [rightBars]
 * @returns {PivotPoint[]}
 */
export function findPivotHighs(data, leftBars = 3, rightBars = 3) {
  if (!data?.length) return []

  const pivots = []
  for (let i = leftBars; i < data.length - rightBars; i++) {
    const high = data[i].high
    let isPivot = true

    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue
      if (data[j].high >= high) {
        isPivot = false
        break
      }
    }

    if (isPivot) {
      pivots.push({
        index: i,
        time: data[i].time,
        price: high,
        type: 'high',
      })
    }
  }

  return pivots
}

/**
 * @param {Candle[]} data
 * @param {number} [leftBars]
 * @param {number} [rightBars]
 * @returns {PivotPoint[]}
 */
export function findPivotLows(data, leftBars = 3, rightBars = 3) {
  if (!data?.length) return []

  const pivots = []
  for (let i = leftBars; i < data.length - rightBars; i++) {
    const low = data[i].low
    let isPivot = true

    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue
      if (data[j].low <= low) {
        isPivot = false
        break
      }
    }

    if (isPivot) {
      pivots.push({
        index: i,
        time: data[i].time,
        price: low,
        type: 'low',
      })
    }
  }

  return pivots
}

function avgVolumeBefore(data, index, period) {
  if (index < period) return null
  let sum = 0
  for (let i = index - period; i < index; i++) {
    sum += data[i].volume ?? 0
  }
  return sum / period
}

function findOutcome(data, secondIndex, necklinePrice, extremePrice, opts, direction) {
  for (let i = secondIndex + 1; i < data.length; i++) {
    const candle = data[i]
    const confirmed = direction === 'up'
      ? candle.close > necklinePrice
      : candle.close < necklinePrice

    if (!confirmed) {
      const failed = direction === 'up'
        ? candle.close < extremePrice
        : candle.close > extremePrice
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

/** ponytail: 0.5% wick slack only — not bottomTolerance (3% L1≈L2 match) */
const INTERMEDIATE_WICK_SLACK = 0.005

/** True when any bar strictly between two bottoms dips below their floor. */
function hasLowerLowBetween(data, l1Index, l2Index, floorPrice) {
  const minAllowed = floorPrice * (1 - INTERMEDIATE_WICK_SLACK)
  for (let i = l1Index + 1; i < l2Index; i++) {
    if (data[i].low < minAllowed) return true
  }
  return false
}

/** True when price breaks below the first bottom before the neckline peak. */
function breaksFirstBottomBeforeNeckline(data, l1Index, h1Index, l1Price) {
  const minAllowed = l1Price * (1 - INTERMEDIATE_WICK_SLACK)
  for (let i = l1Index + 1; i < h1Index; i++) {
    if (data[i].low < minAllowed) return true
  }
  return false
}

function hasHigherHighBetween(data, t1Index, t2Index, ceilingPrice) {
  const maxAllowed = ceilingPrice * (1 + INTERMEDIATE_WICK_SLACK)
  for (let i = t1Index + 1; i < t2Index; i++) {
    if (data[i].high > maxAllowed) return true
  }
  return false
}

function breaksFirstTopBeforeNeckline(data, t1Index, l1Index, t1Price) {
  const maxAllowed = t1Price * (1 + INTERMEDIATE_WICK_SLACK)
  for (let i = t1Index + 1; i < l1Index; i++) {
    if (data[i].high > maxAllowed) return true
  }
  return false
}

function patternEnds(pattern) {
  return pattern.type === 'double-top'
    ? [pattern.t1, pattern.t2]
    : [pattern.l1, pattern.l2]
}

function patternQuality(p) {
  const [first, second] = patternEnds(p)
  const priceDiff = Math.abs(second.price - first.price) / first.price
  return priceDiff + (second.index - first.index) / 1000
}

function dedupeOverlapping(patterns) {
  const ranked = [...patterns].sort((a, b) => patternQuality(a) - patternQuality(b))
  const kept = []

  for (const p of ranked) {
    const [first, second] = patternEnds(p)
    const overlaps = kept.some(k => {
      const [keptFirst, keptSecond] = patternEnds(k)
      return first.index <= keptSecond.index && second.index >= keptFirst.index
    })
    if (!overlaps) kept.push(p)
  }

  return kept.sort((a, b) => patternEnds(a)[0].index - patternEnds(b)[0].index)
}

function toPricePattern(pattern) {
  const isTop = pattern.type === 'double-top'
  const path = isTop
    ? [pattern.l0, pattern.t1, pattern.l1, pattern.t2]
    : [pattern.h0, pattern.l1, pattern.h1, pattern.l2]
  const first = path[1]
  const neckline = path[2]
  const second = path[3]

  return {
    id: pattern.id,
    type: pattern.type,
    nameKey: isTop ? 'patternDoubleTop' : 'patternDoubleBottom',
    status: pattern.status,
    startIndex: first.index,
    color: isTop ? '#ef5350' : '#26a69a',
    lines: [
      { points: path, style: 'status', width: 2 },
      {
        points: [
          { time: first.time, price: neckline.price },
          { time: second.time, price: neckline.price },
        ],
        style: 'dashed',
        width: pattern.status === 'confirmed' ? 2 : 1.5,
      },
    ],
    breakout: pattern.breakout,
    invalidated: pattern.invalidated,
  }
}

/**
 * @param {Candle[]} data
 * @param {DoubleBottomOptions} [options]
 * @returns {PricePattern[]}
 */
export function detectDoubleBottoms(data, options = {}) {
  if (!data?.length) return []

  const opts = { ...DEFAULT_DOUBLE_BOTTOM_OPTIONS, ...options }
  const pivotHighs = findPivotHighs(data, opts.leftBars, opts.rightBars)
  const pivotLows = findPivotLows(data, opts.leftBars, opts.rightBars)
  const patterns = []
  const seenIds = new Set()

  for (const l1 of pivotLows) {
    const l2Candidates = pivotLows.filter(l => {
      if (l.index <= l1.index) return false
      const barsBetween = l.index - l1.index
      if (barsBetween < opts.minBarsBetweenBottoms || barsBetween > opts.maxBarsBetweenBottoms) return false
      const bottomDiff = Math.abs(l.price - l1.price) / l1.price
      return bottomDiff <= opts.bottomTolerance
    })
    if (!l2Candidates.length) continue

    const l2 = l2Candidates.reduce((best, l) => {
      const bestDiff = Math.abs(best.price - l1.price)
      const candDiff = Math.abs(l.price - l1.price)
      if (candDiff !== bestDiff) return candDiff < bestDiff ? l : best
      return l.index > best.index ? l : best
    })

    const floorPrice = Math.min(l1.price, l2.price)
    if (hasLowerLowBetween(data, l1.index, l2.index, floorPrice)) continue

    const betweenHighs = pivotHighs.filter(h => h.index > l1.index && h.index < l2.index)
    if (!betweenHighs.length) continue
    const h1 = betweenHighs.reduce((best, h) => (h.price > best.price ? h : best))

    if (breaksFirstBottomBeforeNeckline(data, l1.index, h1.index, l1.price)) continue

    const h0Candidates = pivotHighs.filter(h => h.index < l1.index)
    if (!h0Candidates.length) continue
    const h0 = h0Candidates[h0Candidates.length - 1]
    const previousHigh = h0Candidates[h0Candidates.length - 2]
    const previousLows = pivotLows.filter(l => l.index < l1.index)
    const previousLow = previousLows[previousLows.length - 1]

    if (!previousHigh || !previousLow) continue
    if (previousHigh.price <= h0.price || previousLow.price <= l1.price) continue

    const id = `${h0.index}-${l1.index}-${h1.index}-${l2.index}`
    if (seenIds.has(id)) continue

    if (h1.price >= h0.price) continue

    const necklineDecline = (h0.price - h1.price) / h0.price
    if (necklineDecline < opts.minNecklineDecline) continue

    const maxBottom = Math.max(l1.price, l2.price)
    if (h1.price <= maxBottom * opts.necklineThreshold) continue

    seenIds.add(id)
    const outcome = findOutcome(data, l2.index, h1.price, floorPrice, opts, 'up')

    patterns.push({
      id,
      type: 'double-bottom',
      h0,
      l1,
      h1,
      l2,
      breakout: outcome.status === 'confirmed' ? outcome.candle : undefined,
      invalidated: outcome.status === 'failed' ? outcome.candle : undefined,
      status: outcome.status,
    })
  }

  return dedupeOverlapping(patterns).map(toPricePattern)
}

/**
 * Vertical mirror of detectDoubleBottoms.
 * @param {Candle[]} data
 * @param {Object} [options]
 * @returns {PricePattern[]}
 */
export function detectDoubleTops(data, options = {}) {
  if (!data?.length) return []

  const opts = { ...DEFAULT_DOUBLE_TOP_OPTIONS, ...options }
  const pivotHighs = findPivotHighs(data, opts.leftBars, opts.rightBars)
  const pivotLows = findPivotLows(data, opts.leftBars, opts.rightBars)
  const patterns = []
  const seenIds = new Set()

  for (const t1 of pivotHighs) {
    const t2Candidates = pivotHighs.filter(t => {
      if (t.index <= t1.index) return false
      const barsBetween = t.index - t1.index
      if (barsBetween < opts.minBarsBetweenTops || barsBetween > opts.maxBarsBetweenTops) return false
      return Math.abs(t.price - t1.price) / t1.price <= opts.topTolerance
    })
    if (!t2Candidates.length) continue

    const t2 = t2Candidates.reduce((best, t) => {
      const bestDiff = Math.abs(best.price - t1.price)
      const candDiff = Math.abs(t.price - t1.price)
      if (candDiff !== bestDiff) return candDiff < bestDiff ? t : best
      return t.index > best.index ? t : best
    })

    const ceilingPrice = Math.max(t1.price, t2.price)
    if (hasHigherHighBetween(data, t1.index, t2.index, ceilingPrice)) continue

    const betweenLows = pivotLows.filter(l => l.index > t1.index && l.index < t2.index)
    if (!betweenLows.length) continue
    const l1 = betweenLows.reduce((best, l) => (l.price < best.price ? l : best))

    if (breaksFirstTopBeforeNeckline(data, t1.index, l1.index, t1.price)) continue

    const l0Candidates = pivotLows.filter(l => l.index < t1.index)
    if (!l0Candidates.length) continue
    const l0 = l0Candidates[l0Candidates.length - 1]
    const previousLow = l0Candidates[l0Candidates.length - 2]
    const previousHighs = pivotHighs.filter(h => h.index < t1.index)
    const previousHigh = previousHighs[previousHighs.length - 1]

    if (!previousLow || !previousHigh) continue
    if (previousLow.price >= l0.price || previousHigh.price >= t1.price) continue

    const id = `top-${l0.index}-${t1.index}-${l1.index}-${t2.index}`
    if (seenIds.has(id)) continue
    if (l1.price <= l0.price) continue

    const necklineRise = (l1.price - l0.price) / l0.price
    if (necklineRise < opts.minNecklineRise) continue

    const minTop = Math.min(t1.price, t2.price)
    if (l1.price >= minTop / opts.necklineThreshold) continue

    seenIds.add(id)
    const outcome = findOutcome(data, t2.index, l1.price, ceilingPrice, opts, 'down')

    patterns.push({
      id,
      type: 'double-top',
      l0,
      t1,
      l1,
      t2,
      breakout: outcome.status === 'confirmed' ? outcome.candle : undefined,
      invalidated: outcome.status === 'failed' ? outcome.candle : undefined,
      status: outcome.status,
    })
  }

  return dedupeOverlapping(patterns).map(toPricePattern)
}
