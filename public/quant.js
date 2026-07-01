'use strict';

/* ════════════════════════════════════════════════════════════════
   Market Terminal — quant engine
   Pure math, no DOM. Everything here operates on plain arrays of
   daily closes / returns computed client-side from chart data the
   app already fetches — no extra server endpoints needed.
   ════════════════════════════════════════════════════════════════ */

const Quant = (() => {
  const TRADING_DAYS_YEAR = 252;

  // ───────────────────────── basic series math ─────────────────────────

  function dailyReturns(closes) {
    const r = [];
    for (let i = 1; i < closes.length; i++) r.push(closes[i] / closes[i - 1] - 1);
    return r;
  }

  function mean(xs) {
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  }

  function stdev(xs) {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
    return Math.sqrt(v);
  }

  function percentile(sortedAsc, p) {
    if (!sortedAsc.length) return NaN;
    const idx = (sortedAsc.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return sortedAsc[lo];
    return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
  }

  // ───────────────────────── risk metrics ─────────────────────────

  function annualizedVol(returns) {
    return stdev(returns) * Math.sqrt(TRADING_DAYS_YEAR);
  }

  function annualizedReturn(returns) {
    return mean(returns) * TRADING_DAYS_YEAR;
  }

  function sharpeRatio(returns, riskFreeAnnual = 0.045) {
    const vol = annualizedVol(returns);
    if (!vol) return null;
    return (annualizedReturn(returns) - riskFreeAnnual) / vol;
  }

  function sortinoRatio(returns, riskFreeAnnual = 0.045) {
    const rfDaily = riskFreeAnnual / TRADING_DAYS_YEAR;
    const downside = returns.filter((r) => r < rfDaily).map((r) => r - rfDaily);
    if (!downside.length) return null;
    const downsideDev = Math.sqrt(mean(downside.map((d) => d * d))) * Math.sqrt(TRADING_DAYS_YEAR);
    if (!downsideDev) return null;
    return (annualizedReturn(returns) - riskFreeAnnual) / downsideDev;
  }

  function maxDrawdown(closes) {
    let peak = closes[0], maxDd = 0, peakIdx = 0, troughIdx = 0, curPeakIdx = 0;
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > peak) { peak = closes[i]; curPeakIdx = i; }
      const dd = (closes[i] - peak) / peak;
      if (dd < maxDd) { maxDd = dd; peakIdx = curPeakIdx; troughIdx = i; }
    }
    return { pct: maxDd, peakIdx, troughIdx };
  }

  function cagr(closes, years) {
    if (closes.length < 2 || years <= 0) return null;
    return (closes[closes.length - 1] / closes[0]) ** (1 / years) - 1;
  }

  function correlation(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 2) return null;
    const x = a.slice(-n), y = b.slice(-n);
    const mx = mean(x), my = mean(y);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
    const denom = Math.sqrt(dx * dy);
    return denom ? num / denom : null;
  }

  function beta(returns, benchReturns) {
    const n = Math.min(returns.length, benchReturns.length);
    if (n < 2) return null;
    const x = benchReturns.slice(-n), y = returns.slice(-n);
    const mx = mean(x), my = mean(y);
    let cov = 0, varX = 0;
    for (let i = 0; i < n; i++) { cov += (x[i] - mx) * (y[i] - my); varX += (x[i] - mx) ** 2; }
    return varX ? cov / varX : null;
  }

  function riskMetrics(closes, benchCloses, years, riskFreeAnnual = 0.045) {
    const returns = dailyReturns(closes);
    const benchReturns = benchCloses ? dailyReturns(benchCloses) : null;
    return {
      volatility: annualizedVol(returns),
      sharpe: sharpeRatio(returns, riskFreeAnnual),
      sortino: sortinoRatio(returns, riskFreeAnnual),
      maxDrawdown: maxDrawdown(closes),
      cagr: cagr(closes, years),
      beta: benchReturns ? beta(returns, benchReturns) : null,
      correlation: benchReturns ? correlation(returns, benchReturns) : null,
    };
  }

  // ───────────────────────── Monte Carlo (GBM) ─────────────────────────

  // Box-Muller standard normal sampler.
  function randNormal() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Simulates `paths` independent GBM price paths `days` trading days ahead,
  // calibrated to the historical annualized drift (mu) and vol (sigma) passed
  // in. Returns per-day percentile bands (for a fan chart) plus the raw
  // terminal-price distribution (for VaR / probability statistics).
  function monteCarloGBM({ S0, mu, sigma, days, paths = 2000 }) {
    const dt = 1 / TRADING_DAYS_YEAR;
    const drift = (mu - 0.5 * sigma * sigma) * dt;
    const vol = sigma * Math.sqrt(dt);

    // matrix[day][path] kept transposed (day-major) so percentile bands per
    // day are cheap to compute without re-walking every path.
    const dayMajor = Array.from({ length: days + 1 }, () => new Float64Array(paths));
    for (let p = 0; p < paths; p++) dayMajor[0][p] = S0;

    for (let p = 0; p < paths; p++) {
      let s = S0;
      for (let d = 1; d <= days; d++) {
        s *= Math.exp(drift + vol * randNormal());
        dayMajor[d][p] = s;
      }
    }

    const bandLevels = [0.05, 0.25, 0.5, 0.75, 0.95];
    const bands = dayMajor.map((dayPrices) => {
      const sorted = Float64Array.from(dayPrices).sort();
      const row = {};
      for (const lvl of bandLevels) row[lvl] = percentile(sorted, lvl);
      return row;
    });

    const terminal = Array.from(dayMajor[days]);
    const terminalReturns = terminal.map((s) => s / S0 - 1).sort((a, b) => a - b);

    return { bands, terminal, terminalReturns, days };
  }

  // VaR / CVaR (Expected Shortfall) on a simulated returns distribution,
  // expressed as positive loss fractions (e.g. 0.12 = a 12% loss).
  function valueAtRisk(sortedReturnsAsc, confidence = 0.95) {
    const q = percentile(sortedReturnsAsc, 1 - confidence);
    const varPct = -q;
    const tail = sortedReturnsAsc.filter((r) => r <= q);
    const cvarPct = tail.length ? -mean(tail) : varPct;
    return { var: varPct, cvar: cvarPct };
  }

  function probAbove(terminalPrices, target) {
    if (!terminalPrices.length) return null;
    return terminalPrices.filter((p) => p >= target).length / terminalPrices.length;
  }

  // ───────────────────────── Black-Scholes ─────────────────────────

  function erf(x) {
    // Abramowitz-Stegun 7.1.26, accurate to ~1.5e-7 — plenty for option Greeks.
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }

  const normCDF = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
  const normPDF = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

  // S = spot, K = strike, T = years to expiry, r = risk-free rate, sigma = annualized IV.
  function blackScholes({ S, K, T, r, sigma, type = 'call' }) {
    if (S <= 0 || K <= 0 || T <= 0 || sigma <= 0) return null;
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    const isCall = type === 'call';
    const Nd1 = normCDF(isCall ? d1 : -d1);
    const Nd2 = normCDF(isCall ? d2 : -d2);
    const price = isCall
      ? S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2)
      : K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
    const delta = isCall ? normCDF(d1) : normCDF(d1) - 1;
    const gamma = normPDF(d1) / (S * sigma * sqrtT);
    const vega = (S * normPDF(d1) * sqrtT) / 100; // per 1 vol-point (1%)
    const theta = isCall
      ? (-S * normPDF(d1) * sigma / (2 * sqrtT) - r * K * Math.exp(-r * T) * normCDF(d2)) / 365
      : (-S * normPDF(d1) * sigma / (2 * sqrtT) + r * K * Math.exp(-r * T) * normCDF(-d2)) / 365;
    const rho = (isCall
      ? K * T * Math.exp(-r * T) * normCDF(d2)
      : -K * T * Math.exp(-r * T) * normCDF(-d2)) / 100;
    return { price, delta, gamma, theta, vega, rho, d1, d2 };
  }

  // ───────────────────────── technical indicators ─────────────────────────

  function sma(closes, period) {
    const out = new Array(closes.length).fill(null);
    let sum = 0;
    for (let i = 0; i < closes.length; i++) {
      sum += closes[i];
      if (i >= period) sum -= closes[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(closes, period) {
    const out = new Array(closes.length).fill(null);
    const k = 2 / (period + 1);
    let prev = null;
    for (let i = 0; i < closes.length; i++) {
      if (prev === null) {
        if (i >= period - 1) { prev = mean(closes.slice(i - period + 1, i + 1)); out[i] = prev; }
      } else {
        prev = closes[i] * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }

  function rsi(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    if (closes.length <= period) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    gain /= period; loss /= period;
    out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    for (let i = period + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
    const emaFast = ema(closes, fast);
    const emaSlow = ema(closes, slow);
    const macdLine = closes.map((_, i) => (emaFast[i] != null && emaSlow[i] != null) ? emaFast[i] - emaSlow[i] : null);
    const macdValues = macdLine.filter((v) => v != null);
    const signalRaw = ema(macdValues, signalPeriod);
    const signalLine = new Array(closes.length).fill(null);
    let j = 0;
    for (let i = 0; i < closes.length; i++) {
      if (macdLine[i] != null) { signalLine[i] = signalRaw[j]; j++; }
    }
    const histogram = closes.map((_, i) => (macdLine[i] != null && signalLine[i] != null) ? macdLine[i] - signalLine[i] : null);
    return { macdLine, signalLine, histogram };
  }

  function bollingerBands(closes, period = 20, mult = 2) {
    const mid = sma(closes, period);
    const upper = new Array(closes.length).fill(null);
    const lower = new Array(closes.length).fill(null);
    for (let i = period - 1; i < closes.length; i++) {
      const sd = stdev(closes.slice(i - period + 1, i + 1));
      upper[i] = mid[i] + mult * sd;
      lower[i] = mid[i] - mult * sd;
    }
    return { mid, upper, lower };
  }

  // ───────────────────────── volatility / range indicators ─────────────────────────

  // candles: [{o,h,l,c}] array
  function atr(candles, period = 14) {
    const out = new Array(candles.length).fill(null);
    if (candles.length < 2) return out;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const h = candles[i].h, l = candles[i].l, pc = candles[i - 1].c;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    if (trs.length < period) return out;
    let val = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    out[period] = val;
    for (let i = period; i < trs.length; i++) {
      val = (val * (period - 1) + trs[i]) / period;
      out[i + 1] = val;
    }
    return out;
  }

  function stochastic(closes, highs, lows, kPeriod = 14, dPeriod = 3) {
    const k = new Array(closes.length).fill(null);
    for (let i = kPeriod - 1; i < closes.length; i++) {
      const h = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
      const l = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
      k[i] = h === l ? 50 : ((closes[i] - l) / (h - l)) * 100;
    }
    const d = new Array(closes.length).fill(null);
    for (let i = kPeriod + dPeriod - 2; i < closes.length; i++) {
      let sum = 0;
      for (let j = 0; j < dPeriod; j++) sum += k[i - j];
      d[i] = sum / dPeriod;
    }
    return { k, d };
  }

  function williamsR(closes, highs, lows, period = 14) {
    const out = new Array(closes.length).fill(null);
    for (let i = period - 1; i < closes.length; i++) {
      const h = Math.max(...highs.slice(i - period + 1, i + 1));
      const l = Math.min(...lows.slice(i - period + 1, i + 1));
      out[i] = h === l ? -50 : ((h - closes[i]) / (h - l)) * -100;
    }
    return out;
  }

  function cci(closes, highs, lows, period = 20) {
    const out = new Array(closes.length).fill(null);
    for (let i = period - 1; i < closes.length; i++) {
      const tps = [];
      for (let j = i - period + 1; j <= i; j++) tps.push((highs[j] + lows[j] + closes[j]) / 3);
      const tp = tps[tps.length - 1];
      const avgTp = tps.reduce((a, b) => a + b, 0) / period;
      const md = tps.reduce((a, b) => a + Math.abs(b - avgTp), 0) / period;
      out[i] = md === 0 ? 0 : (tp - avgTp) / (0.015 * md);
    }
    return out;
  }

  function keltnerChannels(closes, highs, lows, period = 20, mult = 2) {
    const mid = ema(closes, period);
    const candles = closes.map((c, i) => ({ c, h: highs[i], l: lows[i], o: c }));
    const atrVals = atr(candles, period);
    const upper = new Array(closes.length).fill(null);
    const lower = new Array(closes.length).fill(null);
    for (let i = 0; i < closes.length; i++) {
      if (mid[i] !== null && atrVals[i] !== null) {
        upper[i] = mid[i] + mult * atrVals[i];
        lower[i] = mid[i] - mult * atrVals[i];
      }
    }
    return { mid, upper, lower };
  }

  function parabolicSar(highs, lows, step = 0.02, max = 0.2) {
    const n = highs.length;
    const sar = new Array(n).fill(null);
    if (n < 2) return sar;
    let bull = true, af = step, ep = lows[0];
    sar[0] = highs[0];
    for (let i = 1; i < n; i++) {
      const prev = sar[i - 1];
      let next;
      if (bull) {
        next = prev + af * (ep - prev);
        next = Math.min(next, lows[i - 1], i > 1 ? lows[i - 2] : lows[i - 1]);
        if (lows[i] < next) { bull = false; next = ep; ep = lows[i]; af = step; }
        else if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + step, max); }
      } else {
        next = prev + af * (ep - prev);
        next = Math.max(next, highs[i - 1], i > 1 ? highs[i - 2] : highs[i - 1]);
        if (highs[i] > next) { bull = true; next = ep; ep = highs[i]; af = step; }
        else if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + step, max); }
      }
      sar[i] = next;
    }
    return sar;
  }

  // Returns Fibonacci retracement and extension levels between a swing high and low.
  function fibonacci(high, low) {
    const diff = high - low;
    return {
      ext1618: high + 0.618 * diff,
      ext1000: high,
      level0:   high,
      level236: high - 0.236 * diff,
      level382: high - 0.382 * diff,
      level500: high - 0.500 * diff,
      level618: high - 0.618 * diff,
      level786: high - 0.786 * diff,
      level1000: low,
      ext1618ext: low - 0.618 * diff,
    };
  }

  // Rate of Change (momentum oscillator, %).
  function rateOfChange(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    for (let i = period; i < closes.length; i++) {
      const base = closes[i - period];
      out[i] = base !== 0 ? ((closes[i] - base) / base) * 100 : null;
    }
    return out;
  }

  // ───────────────────────── extended risk / portfolio metrics ─────────────────────────

  function calmarRatio(closes, years) {
    if (!closes || closes.length < 2 || years <= 0) return null;
    const returns = dailyReturns(closes);
    const annReturn = annualizedReturn(returns);
    const { pct: dd } = maxDrawdown(closes);
    return dd ? annReturn / Math.abs(dd) : null;
  }

  function treynorRatio(returns, benchReturns, riskFreeAnnual = 0.045) {
    const b = beta(returns, benchReturns);
    if (!b) return null;
    return (annualizedReturn(returns) - riskFreeAnnual) / b;
  }

  function jensenAlpha(returns, benchReturns, riskFreeAnnual = 0.045) {
    const b = beta(returns, benchReturns);
    if (b === null) return null;
    return annualizedReturn(returns) - (riskFreeAnnual + b * (annualizedReturn(benchReturns) - riskFreeAnnual));
  }

  function trackingError(returns, benchReturns) {
    const n = Math.min(returns.length, benchReturns.length);
    if (n < 2) return null;
    const active = [];
    for (let i = 0; i < n; i++) active.push(returns[returns.length - n + i] - benchReturns[benchReturns.length - n + i]);
    return stdev(active) * Math.sqrt(TRADING_DAYS_YEAR);
  }

  function informationRatio(returns, benchReturns) {
    const te = trackingError(returns, benchReturns);
    if (!te) return null;
    const n = Math.min(returns.length, benchReturns.length);
    const active = [];
    for (let i = 0; i < n; i++) active.push(returns[returns.length - n + i] - benchReturns[benchReturns.length - n + i]);
    return (mean(active) * TRADING_DAYS_YEAR) / te;
  }

  function kellyCriterion(returns) {
    const wins = returns.filter((r) => r > 0);
    const losses = returns.filter((r) => r < 0);
    if (!wins.length || !losses.length) return null;
    const winRate = wins.length / returns.length;
    const avgWin = mean(wins);
    const avgLoss = Math.abs(mean(losses));
    if (!avgLoss) return null;
    return winRate - (1 - winRate) / (avgWin / avgLoss);
  }

  function ulcerIndex(closes) {
    if (closes.length < 2) return null;
    let peak = closes[0], sumSq = 0;
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > peak) peak = closes[i];
      const dd = ((closes[i] - peak) / peak) * 100;
      sumSq += dd * dd;
    }
    return Math.sqrt(sumSq / closes.length);
  }

  function historicalVaR(returns, confidence = 0.95) {
    if (!returns.length) return null;
    const sorted = [...returns].sort((a, b) => a - b);
    const q = percentile(sorted, 1 - confidence);
    const tail = sorted.filter((r) => r <= q);
    return { var: -q, cvar: tail.length ? -mean(tail) : -q };
  }

  function omegaRatio(returns, threshold = 0) {
    let gains = 0, losses = 0;
    for (const r of returns) {
      if (r > threshold) gains += r - threshold;
      else losses += threshold - r;
    }
    return losses === 0 ? null : gains / losses;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  FULL 40-INDICATOR SUITE — additions to reach the complete spec
  // ═══════════════════════════════════════════════════════════════════════

  // ── Trend ────────────────────────────────────────────────────────────

  // ADX (14) — Average Directional Index with +DI / −DI
  function adx(highs, lows, closes, period = 14) {
    const n = closes.length;
    const outADX = new Array(n).fill(null);
    const outDIPlus = new Array(n).fill(null);
    const outDIMinus = new Array(n).fill(null);
    if (n < period * 2 + 1) return { adx: outADX, diPlus: outDIPlus, diMinus: outDIMinus };

    const trArr = [], dmPlusArr = [], dmMinusArr = [];
    for (let i = 1; i < n; i++) {
      const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
      const up = highs[i] - highs[i - 1], dn = lows[i - 1] - lows[i];
      trArr.push(tr);
      dmPlusArr.push(up > dn && up > 0 ? up : 0);
      dmMinusArr.push(dn > up && dn > 0 ? dn : 0);
    }

    // Wilder smoothing (running sum, not EMA)
    const wilder = (arr, p) => {
      const s = new Array(arr.length).fill(null);
      let v = arr.slice(0, p).reduce((a, b) => a + b, 0);
      s[p - 1] = v;
      for (let i = p; i < arr.length; i++) { v = v - v / p + arr[i]; s[i] = v; }
      return s;
    };
    const atrS = wilder(trArr, period);
    const dmPS = wilder(dmPlusArr, period);
    const dmMS = wilder(dmMinusArr, period);

    const dxArr = [];
    for (let i = period - 1; i < trArr.length; i++) {
      const diP = atrS[i] ? (dmPS[i] / atrS[i]) * 100 : 0;
      const diM = atrS[i] ? (dmMS[i] / atrS[i]) * 100 : 0;
      outDIPlus[i + 1] = diP;
      outDIMinus[i + 1] = diM;
      dxArr.push((diP + diM) ? Math.abs(diP - diM) / (diP + diM) * 100 : 0);
    }

    if (dxArr.length >= period) {
      let adxVal = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
      const base = period + period;
      outADX[base] = adxVal;
      for (let i = period; i < dxArr.length; i++) {
        adxVal = (adxVal * (period - 1) + dxArr[i]) / period;
        outADX[i + period + 1] = adxVal;
      }
    }
    return { adx: outADX, diPlus: outDIPlus, diMinus: outDIMinus };
  }

  // Ichimoku Cloud — all 5 components
  function ichimoku(highs, lows, closes) {
    const n = closes.length;
    const tenkan   = new Array(n).fill(null);
    const kijun    = new Array(n).fill(null);
    const senkouA  = new Array(n + 52).fill(null);
    const senkouB  = new Array(n + 52).fill(null);
    const chikou   = new Array(n).fill(null);

    const midHL = (i, p) => {
      let h = -Infinity, l = Infinity;
      for (let j = i - p + 1; j <= i; j++) { if (highs[j] > h) h = highs[j]; if (lows[j] < l) l = lows[j]; }
      return (h + l) / 2;
    };

    for (let i = 0; i < n; i++) {
      if (i >= 8)  tenkan[i]  = midHL(i, 9);
      if (i >= 25) kijun[i]   = midHL(i, 26);
      if (i >= 26) chikou[i - 26] = closes[i];
      if (tenkan[i] !== null && kijun[i] !== null) senkouA[i + 26] = (tenkan[i] + kijun[i]) / 2;
      if (i >= 51) senkouB[i + 26] = midHL(i, 52);
    }
    return { tenkan, kijun, senkouA, senkouB, chikou };
  }

  // Hull Moving Average — HMA(n) = EMA(2·EMA(n/2) − EMA(n), √n)
  function hullMA(closes, period = 20) {
    const half = Math.floor(period / 2);
    const sqrtP = Math.round(Math.sqrt(period));
    const eH = ema(closes, half), eF = ema(closes, period);
    const diff = closes.map((_, i) =>
      eH[i] !== null && eF[i] !== null ? 2 * eH[i] - eF[i] : null);
    const vals = diff.filter(v => v !== null);
    const hRaw = ema(vals, sqrtP);
    const out = new Array(closes.length).fill(null);
    let j = 0;
    for (let i = 0; i < closes.length; i++) { if (diff[i] !== null) { out[i] = hRaw[j++]; } }
    return out;
  }

  // ZigZag (5 % swing filter)
  function zigzag(closes, pct = 0.05) {
    const out = new Array(closes.length).fill(null);
    if (closes.length < 2) return out;
    let pivotIdx = 0, pivotPrice = closes[0], dir = 0;
    out[0] = closes[0];
    for (let i = 1; i < closes.length; i++) {
      const chg = (closes[i] - pivotPrice) / pivotPrice;
      if (dir <= 0 && chg >= pct) {
        out[pivotIdx] = pivotPrice; pivotIdx = i; pivotPrice = closes[i]; dir = 1;
      } else if (dir >= 0 && chg <= -pct) {
        out[pivotIdx] = pivotPrice; pivotIdx = i; pivotPrice = closes[i]; dir = -1;
      } else if (dir === 1 && closes[i] > pivotPrice) {
        pivotPrice = closes[i]; pivotIdx = i;
      } else if (dir === -1 && closes[i] < pivotPrice) {
        pivotPrice = closes[i]; pivotIdx = i;
      }
    }
    out[pivotIdx] = pivotPrice;
    return out;
  }

  // ── Momentum ──────────────────────────────────────────────────────────

  // Chande Momentum Oscillator (CMO, period = 14)
  function cmo(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    for (let i = period; i < closes.length; i++) {
      let up = 0, dn = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const d = closes[j] - closes[j - 1];
        if (d > 0) up += d; else dn -= d;
      }
      out[i] = (up + dn) ? ((up - dn) / (up + dn)) * 100 : 0;
    }
    return out;
  }

  // Money Flow Index (MFI, period = 14) — needs volume
  function mfi(highs, lows, closes, volumes, period = 14) {
    const out = new Array(closes.length).fill(null);
    const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
    for (let i = period; i < closes.length; i++) {
      let pos = 0, neg = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const mfv = tp[j] * (volumes[j] || 0);
        if (tp[j] >= tp[j - 1]) pos += mfv; else neg += mfv;
      }
      out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
    }
    return out;
  }

  // Awesome Oscillator (34/5 SMA of midpoints)
  function awesomeOscillator(highs, lows) {
    const mid = highs.map((h, i) => (h + lows[i]) / 2);
    const fast = sma(mid, 5), slow = sma(mid, 34);
    return mid.map((_, i) => fast[i] !== null && slow[i] !== null ? fast[i] - slow[i] : null);
  }

  // ── Volatility ────────────────────────────────────────────────────────

  // Donchian Channels (period = 20)
  function donchianChannels(highs, lows, period = 20) {
    const n = highs.length;
    const upper = new Array(n).fill(null), lower = new Array(n).fill(null);
    for (let i = period - 1; i < n; i++) {
      upper[i] = Math.max(...highs.slice(i - period + 1, i + 1));
      lower[i] = Math.min(...lows.slice(i - period + 1, i + 1));
    }
    const mid = upper.map((u, i) => u !== null && lower[i] !== null ? (u + lower[i]) / 2 : null);
    return { upper, lower, mid };
  }

  // Chaikin Volatility — EMA of H−L then ROC of that EMA
  function chaikinVolatility(highs, lows, period = 10) {
    const hl = highs.map((h, i) => h - lows[i]);
    const eHL = ema(hl, period);
    const out = new Array(hl.length).fill(null);
    for (let i = period; i < eHL.length; i++) {
      if (eHL[i] !== null && eHL[i - period] && eHL[i - period] !== 0)
        out[i] = ((eHL[i] - eHL[i - period]) / eHL[i - period]) * 100;
    }
    return out;
  }

  // Standard Deviation indicator (rolling period = 20)
  function rollingStdDev(closes, period = 20) {
    const out = new Array(closes.length).fill(null);
    for (let i = period - 1; i < closes.length; i++)
      out[i] = stdev(closes.slice(i - period + 1, i + 1));
    return out;
  }

  // Historical Volatility — 30-day annualized rolling σ of log returns
  function historicalVolatility(closes, period = 30) {
    const logR = [];
    for (let i = 1; i < closes.length; i++) logR.push(Math.log(closes[i] / closes[i - 1]));
    const out = new Array(closes.length).fill(null);
    for (let i = period; i < closes.length; i++)
      out[i] = stdev(logR.slice(i - period, i)) * Math.sqrt(TRADING_DAYS_YEAR);
    return out;
  }

  // ── Volume ────────────────────────────────────────────────────────────

  // On-Balance Volume
  function obv(closes, volumes) {
    const out = new Array(closes.length).fill(null);
    if (!volumes || closes.length !== volumes.length) return out;
    let running = 0;
    out[0] = 0;
    for (let i = 1; i < closes.length; i++) {
      const v = volumes[i] || 0;
      if (closes[i] > closes[i - 1]) running += v;
      else if (closes[i] < closes[i - 1]) running -= v;
      out[i] = running;
    }
    return out;
  }

  // Chaikin Money Flow (CMF, period = 21)
  function cmf(highs, lows, closes, volumes, period = 21) {
    const out = new Array(closes.length).fill(null);
    for (let i = period - 1; i < closes.length; i++) {
      let mfvSum = 0, volSum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const hl = highs[j] - lows[j];
        const clv = hl ? ((closes[j] - lows[j]) - (highs[j] - closes[j])) / hl : 0;
        const v = volumes[j] || 0;
        mfvSum += clv * v; volSum += v;
      }
      out[i] = volSum ? mfvSum / volSum : 0;
    }
    return out;
  }

  // VWAP — cumulative (intraday from first bar)
  function vwap(closes, volumes, highs, lows) {
    const out = new Array(closes.length).fill(null);
    let cumTP = 0, cumVol = 0;
    for (let i = 0; i < closes.length; i++) {
      const tp = highs && lows ? (highs[i] + lows[i] + closes[i]) / 3 : closes[i];
      const v = volumes ? volumes[i] || 0 : 1;
      cumTP += tp * v; cumVol += v;
      out[i] = cumVol ? cumTP / cumVol : closes[i];
    }
    return out;
  }

  // Accumulation / Distribution Line
  function adLine(highs, lows, closes, volumes) {
    const out = new Array(closes.length).fill(null);
    let running = 0;
    for (let i = 0; i < closes.length; i++) {
      const hl = highs[i] - lows[i];
      const clv = hl ? ((closes[i] - lows[i]) - (highs[i] - closes[i])) / hl : 0;
      running += clv * (volumes[i] || 0);
      out[i] = running;
    }
    return out;
  }

  // Volume Profile — 50 discrete price bins
  function volumeProfile(closes, volumes, bins = 50) {
    if (!closes.length || !volumes) return [];
    const minP = Math.min(...closes), maxP = Math.max(...closes);
    const binSize = (maxP - minP) / bins || 1;
    const profile = Array.from({ length: bins }, (_, k) => ({
      priceLow:  minP + k * binSize,
      priceHigh: minP + (k + 1) * binSize,
      priceMid:  minP + (k + 0.5) * binSize,
      volume: 0,
    }));
    for (let i = 0; i < closes.length; i++) {
      const bin = Math.min(Math.floor((closes[i] - minP) / binSize), bins - 1);
      profile[bin].volume += volumes[i] || 0;
    }
    const maxVol = Math.max(...profile.map(b => b.volume)) || 1;
    profile.forEach(b => { b.pct = b.volume / maxVol; });
    return profile;
  }

  // Force Index — (close − prevClose) × volume, smoothed with EMA(13)
  function forceIndex(closes, volumes, period = 13) {
    const raw = new Array(closes.length).fill(null);
    for (let i = 1; i < closes.length; i++)
      raw[i] = (closes[i] - closes[i - 1]) * (volumes[i] || 0);
    const rawFilled = raw.map(v => v ?? 0);
    const smoothed = ema(rawFilled, period);
    return smoothed.map((v, i) => raw[i] !== null ? v : null);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ADVANCED STOCHASTIC CALCULUS — Module 2.2
  // ═══════════════════════════════════════════════════════════════════════

  // Rough Jump-Diffusion Monte Carlo
  // Hurst H < 0.5 → rough long-memory volatility
  // Poisson jump intensity λ with lognormal jump sizes (μJ, σJ)
  function roughJumpDiffusion({ S0, mu, sigma, days, paths = 2000, H = 0.35, lambda = 2, muJ = -0.05, sigmaJ = 0.08 }) {
    const dt = 1 / TRADING_DAYS_YEAR;
    const sqrtDt = Math.sqrt(dt);

    // Approximate fractional Brownian motion increments using autocovariance filter
    // γ(k) = ½(|k+1|^{2H} − 2|k|^{2H} + |k−1|^{2H})
    function fBMIncrements(n) {
      const maxLag = Math.min(n, 60);
      const gamma = new Float64Array(maxLag);
      for (let k = 0; k < maxLag; k++)
        gamma[k] = 0.5 * (Math.pow(k + 1, 2 * H) - 2 * Math.pow(k || 1e-10, 2 * H) + (k > 0 ? Math.pow(k - 1, 2 * H) : 0));
      const z = new Float64Array(n);
      for (let i = 0; i < n; i++) z[i] = randNormal();
      const inc = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        const lim = Math.min(i + 1, maxLag);
        for (let k = 0; k < lim; k++) s += Math.sqrt(Math.abs(gamma[k])) * z[i - k];
        inc[i] = s;
      }
      // Normalize so path-variance ≈ 1
      let v2 = 0;
      for (let i = 0; i < n; i++) v2 += inc[i] * inc[i];
      const norm = Math.sqrt(v2 / n) || 1;
      for (let i = 0; i < n; i++) inc[i] /= norm;
      return inc;
    }

    const dayMajor = Array.from({ length: days + 1 }, () => new Float64Array(paths));
    for (let p = 0; p < paths; p++) dayMajor[0][p] = S0;

    const jumpCompensator = lambda * (Math.exp(muJ + 0.5 * sigmaJ * sigmaJ) - 1);

    for (let p = 0; p < paths; p++) {
      let s = S0;
      const fInc = fBMIncrements(days);
      for (let d = 1; d <= days; d++) {
        const diffusion = (mu - 0.5 * sigma * sigma - jumpCompensator) * dt + sigma * fInc[d - 1] * sqrtDt;
        let jump = 0;
        if (Math.random() < 1 - Math.exp(-lambda * dt))
          jump = muJ + sigmaJ * randNormal();
        s *= Math.exp(diffusion + jump);
        dayMajor[d][p] = s;
      }
    }

    const bandLevels = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];
    const bands = dayMajor.map(row => {
      const sorted = Float64Array.from(row).sort();
      const r = {};
      for (const lvl of bandLevels) r[lvl] = percentile(sorted, lvl);
      return r;
    });
    const terminal = Array.from(dayMajor[days]);
    const terminalReturns = terminal.map(s => s / S0 - 1).sort((a, b) => a - b);
    return { bands, terminal, terminalReturns, days, model: 'rough-jump-diffusion', H, lambda };
  }

  // Heston Stochastic Volatility Model (full-truncation Euler scheme)
  // dS = μS dt + √v S dW₁
  // dv = κ(θ−v)dt + ξ√v dW₂,  Corr(dW₁,dW₂) = ρ
  function hestonMC({ S0, mu = 0.08, v0 = 0.04, kappa = 2.0, theta = 0.04, xi = 0.5, rho = -0.7, days = 252, paths = 1000 }) {
    const dt = 1 / TRADING_DAYS_YEAR, sqrtDt = Math.sqrt(dt);
    const rhoPerp = Math.sqrt(Math.max(1 - rho * rho, 0));
    const dayMajor = Array.from({ length: days + 1 }, () => new Float64Array(paths));
    for (let p = 0; p < paths; p++) dayMajor[0][p] = S0;

    for (let p = 0; p < paths; p++) {
      let s = S0, v = v0;
      for (let d = 1; d <= days; d++) {
        const z1 = randNormal(), z2 = randNormal();
        const dW1 = sqrtDt * z1;
        const dW2 = sqrtDt * (rho * z1 + rhoPerp * z2);
        const vPos = Math.max(v, 0);
        v = v + kappa * (theta - vPos) * dt + xi * Math.sqrt(vPos) * dW2;
        s = s * Math.exp((mu - 0.5 * vPos) * dt + Math.sqrt(vPos) * dW1);
        dayMajor[d][p] = s;
      }
    }

    const bandLevels = [0.05, 0.25, 0.5, 0.75, 0.95];
    const bands = dayMajor.map(row => {
      const sorted = Float64Array.from(row).sort();
      const r = {};
      for (const lvl of bandLevels) r[lvl] = percentile(sorted, lvl);
      return r;
    });
    const terminal = Array.from(dayMajor[days]);
    const terminalReturns = terminal.map(s => s / S0 - 1).sort((a, b) => a - b);
    return { bands, terminal, terminalReturns, days, model: 'heston', v0, kappa, theta, xi, rho };
  }

  // Heston calibration — coordinate-descent optimizer minimizing SSE against market options
  // options: [{K, T, type:'call'|'put', marketPrice}]; S = spot; r = risk-free rate
  function calibrateHeston(options, S, r = 0.045) {
    // Simplified Heston call price via Lewis (2001) — real-axis FFT quadrature
    function hestonCallPrice(S, K, T, r, v0, kappa, theta, xi, rho) {
      if (T <= 0 || v0 <= 0 || K <= 0) return null;
      const F = S * Math.exp(r * T);
      const x = Math.log(F / K);
      const N = 128, duMax = 200, du = duMax / N;
      let integral = 0;

      for (let k = 1; k <= N; k++) {
        const u = (k - 0.5) * du;
        // Gatheral form of Heston characteristic function (numerically stable)
        const ui = u; // u is real; i*u terms handled below
        const d = Math.sqrt(Math.max((rho * xi * ui) ** 2 + xi ** 2 * (ui ** 2 + 0.25), 0));
        const g = (kappa - rho * xi * ui - d) / (kappa - rho * xi * ui + d + 1e-15);
        const expDT = Math.exp(-d * T);
        const D = (kappa - rho * xi * ui - d) * (1 - expDT) / (1 - g * expDT + 1e-15);
        const C = kappa * theta / (xi * xi) * ((kappa - rho * xi * ui - d) * T - 2 * Math.log(Math.abs((1 - g * expDT) / (1 - g + 1e-15))));
        const cfReal = Math.exp(C + D * v0) * Math.cos(u * x);
        integral += cfReal / (u ** 2 + 0.25) * du;
      }
      return Math.max(F * Math.exp(-r * T) - (Math.sqrt(F * K) * Math.exp(-r * T)) / Math.PI * integral, 0);
    }

    const loss = ([v0, kappa, theta, xi, rho]) => {
      if (v0 <= 0 || kappa <= 0 || theta <= 0 || xi <= 0 || Math.abs(rho) >= 1) return 1e10;
      let sse = 0;
      for (const o of options) {
        const p = hestonCallPrice(S, o.K, o.T, r, v0, kappa, theta, xi, rho);
        if (p === null) return 1e10;
        const mp = (o.type === 'put') ? p - S * Math.exp(-r * o.T) + o.K * Math.exp(-r * o.T) : p;
        sse += (mp - o.marketPrice) ** 2;
      }
      return sse;
    };

    // Default energy-sector priors (MPC / PSX calibration targets)
    let best = [0.06, 2.5, 0.05, 0.60, -0.65];
    let bestL = loss(best);
    const steps = [0.005, 0.3, 0.005, 0.05, 0.05];
    for (let iter = 0; iter < 800; iter++) {
      const idx = iter % 5;
      for (const sign of [1, -1]) {
        const cand = best.slice();
        cand[idx] += sign * steps[idx];
        const l = loss(cand);
        if (l < bestL) { bestL = l; best = cand; }
      }
      steps[idx] *= 0.98;
    }
    const [v0, kappa, theta, xi, rho] = best;
    return { v0, kappa, theta, xi, rho, loss: bestL };
  }

  // Malliavin Greeks — integration-by-parts on Monte Carlo paths
  // Avoids finite-difference bumping. Input: monte carlo result + option params.
  function malliavinGreeks({ terminal, S0, sigma, T, K, r = 0.045, type = 'call' }) {
    const n = terminal.length;
    if (!n || sigma <= 0 || T <= 0) return null;
    const drift = (r - 0.5 * sigma * sigma) * T;
    const sigT = sigma * Math.sqrt(T);

    // Recover standardised Brownian motion at T for each path
    // W_T ≈ (log(S_T / S0) − drift) / sigma
    const payoffs  = terminal.map(ST => Math.max((type === 'call' ? ST - K : K - ST), 0) * Math.exp(-r * T));
    const wArr     = terminal.map(ST => (Math.log(ST / S0) - drift) / sigma);

    // Malliavin weights (Fournié et al.)
    // Delta:  H₁ = W_T / (S0·σ·T)
    // Gamma:  H₂ = (W_T² − T) / (S0²·σ²·T²)    (second-order weight)
    // Vega:   H_v = (W_T·σ − T·σ²) / (σ²·√T)  → simplified to (W_T/σ − √T)/(σ·√T)
    const E = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

    const delta = E(payoffs.map((p, i) => p * wArr[i] / (S0 * sigma * T)));
    const gamma = E(payoffs.map((p, i) => p * (wArr[i] * wArr[i] - T) / (S0 * S0 * sigma * sigma * T * T)));
    const vega  = E(payoffs.map((p, i) => p * (wArr[i] * wArr[i] / sigma - T * sigma) / (sigT * sigT))) / 100;

    return { delta, gamma, vega };
  }

  // Roll Model — bid-ask spread decomposition from price-change serial covariance
  // prices: array of transaction prices (tick data or OHLC close sequence)
  function rollModel(prices) {
    if (prices.length < 20) return null;
    const changes = [];
    for (let i = 1; i < prices.length; i++) changes.push(prices[i] - prices[i - 1]);
    const mc = mean(changes);
    let cov1 = 0;
    for (let i = 1; i < changes.length; i++) cov1 += (changes[i] - mc) * (changes[i - 1] - mc);
    cov1 /= (changes.length - 1);

    const halfSpread = cov1 < 0 ? Math.sqrt(-cov1) : 0;
    const effectiveSpread = 2 * halfSpread;
    const totalVar = stdev(changes) ** 2;
    const transitoryVar = 2 * halfSpread ** 2;
    const permanentVar = Math.max(totalVar - transitoryVar, 0);
    const adverseSelection = totalVar ? permanentVar / totalVar : 0;

    return {
      effectiveSpread,
      halfSpread,
      adverseSelection,
      informationLeakage: 1 - adverseSelection,
      serialCov: cov1,
    };
  }

  // ───────────────────────── candlestick pattern detection ─────────────────────────

  // candles: [{o,h,l,c}] array, chronological (oldest first, newest last).
  function detectCandlePatterns(candles) {
    const patterns = [];
    const n = candles.length;
    if (n < 1) return patterns;

    const body    = (c) => Math.abs(c.c - c.o);
    const range   = (c) => c.h - c.l || 0.0001;
    const isBull  = (c) => c.c >= c.o;
    const upShadow  = (c) => c.h - Math.max(c.o, c.c);
    const dnShadow  = (c) => Math.min(c.o, c.c) - c.l;
    const avgBody = candles.reduce((a, c) => a + body(c), 0) / n || 0.0001;

    const push = (name, type, confidence, candlesInvolved, candleIndex, description) =>
      patterns.push({ name, type, confidence, candlesInvolved, candleIndex, description });

    const cur = candles[n - 1];
    const curBody = body(cur), curRange = range(cur);

    // ── Single-candle ──
    if (curBody / curRange < 0.1)
      push('Doji', 'neutral', 'medium', 1, 0, 'Tiny body signals indecision; watch for a trend reversal or continuation break.');

    if (curBody > 0 && dnShadow(cur) >= 2 * curBody && upShadow(cur) <= 0.15 * curRange) {
      const downtrend = n >= 5 && cur.c < candles[n - 5].c;
      push(downtrend ? 'Hammer' : 'Hanging Man', downtrend ? 'bullish' : 'bearish', 'medium', 1, 0,
        downtrend ? 'Long lower wick after downtrend — potential bullish reversal.' : 'Long lower wick at the top — potential distribution / bearish reversal.');
    }

    if (curBody > 0 && upShadow(cur) >= 2 * curBody && dnShadow(cur) <= 0.15 * curRange) {
      const uptrend = n >= 5 && cur.c > candles[n - 5].c;
      push(uptrend ? 'Shooting Star' : 'Inverted Hammer', uptrend ? 'bearish' : 'bullish', 'medium', 1, 0,
        uptrend ? 'Long upper wick rejected at the high — bearish reversal signal.' : 'Inverted hammer in a downtrend — watch for bullish follow-through.');
    }

    if (curBody / curRange > 0.95)
      push(isBull(cur) ? 'Bullish Marubozu' : 'Bearish Marubozu', isBull(cur) ? 'bullish' : 'bearish', 'high', 1, 0,
        isBull(cur) ? 'Full-body bullish candle; buyers in total control.' : 'Full-body bearish candle; sellers in total control.');

    if (curBody / curRange < 0.25 && Math.abs(upShadow(cur) - dnShadow(cur)) < curRange * 0.2 && curBody / curRange >= 0.1)
      push('Spinning Top', 'neutral', 'low', 1, 0, 'Small body with balanced shadows — market indecision between bulls and bears.');

    // ── Two-candle ──
    if (n >= 2) {
      const p = candles[n - 2];

      if (!isBull(p) && isBull(cur) && cur.o < p.c && cur.c > p.o && body(cur) > body(p))
        push('Bullish Engulfing', 'bullish', 'high', 2, 0, 'Bullish candle fully engulfs prior bearish — strong buying pressure and reversal signal.');

      if (isBull(p) && !isBull(cur) && cur.o > p.c && cur.c < p.o && body(cur) > body(p))
        push('Bearish Engulfing', 'bearish', 'high', 2, 0, 'Bearish candle fully engulfs prior bullish — strong selling pressure and reversal signal.');

      if (!isBull(p) && isBull(cur) && cur.o > p.c && cur.c < p.o && body(cur) < body(p) * 0.5)
        push('Bullish Harami', 'bullish', 'medium', 2, 0, 'Small bullish candle inside a large bearish — selling momentum slowing, potential reversal.');

      if (isBull(p) && !isBull(cur) && cur.o < p.c && cur.c > p.o && body(cur) < body(p) * 0.5)
        push('Bearish Harami', 'bearish', 'medium', 2, 0, 'Small bearish candle inside a large bullish — buying momentum slowing, potential reversal.');

      if (isBull(p) && !isBull(cur) && cur.o > p.h && cur.c < (p.o + p.c) / 2 && body(cur) > avgBody * 0.5)
        push('Dark Cloud Cover', 'bearish', 'high', 2, 0, 'Opens above prior high then closes below midpoint — bearish reversal on confirmed break of prior high.');

      if (!isBull(p) && isBull(cur) && cur.o < p.l && cur.c > (p.o + p.c) / 2 && body(cur) > avgBody * 0.5)
        push('Piercing Line', 'bullish', 'high', 2, 0, 'Opens below prior low then closes above midpoint — bullish reversal with strong buying from lows.');

      if (isBull(p) && !isBull(cur) && Math.abs(p.h - cur.h) < range(p) * 0.02)
        push('Tweezer Top', 'bearish', 'medium', 2, 0, 'Equal highs signal a resistance level and potential bearish reversal.');

      if (!isBull(p) && isBull(cur) && Math.abs(p.l - cur.l) < range(p) * 0.02)
        push('Tweezer Bottom', 'bullish', 'medium', 2, 0, 'Equal lows signal a support level and potential bullish reversal.');
    }

    // ── Three-candle ──
    if (n >= 3) {
      const c1 = candles[n - 3], c2 = candles[n - 2], c3 = candles[n - 1];

      if (!isBull(c1) && body(c2) < avgBody * 0.4 && isBull(c3) && c3.c > (c1.o + c1.c) / 2)
        push('Morning Star', 'bullish', 'high', 3, 0, 'Classic three-candle bullish reversal: large bearish → indecision → large bullish.');

      if (isBull(c1) && body(c2) < avgBody * 0.4 && !isBull(c3) && c3.c < (c1.o + c1.c) / 2)
        push('Evening Star', 'bearish', 'high', 3, 0, 'Classic three-candle bearish reversal: large bullish → indecision → large bearish.');

      if (!isBull(c1) && body(c2) / range(c2) < 0.1 && isBull(c3) && c3.c > (c1.o + c1.c) / 2)
        push('Morning Doji Star', 'bullish', 'high', 3, 0, 'Bearish candle + doji gap + bullish candle — very strong reversal signal at the bottom.');

      if (isBull(c1) && body(c2) / range(c2) < 0.1 && !isBull(c3) && c3.c < (c1.o + c1.c) / 2)
        push('Evening Doji Star', 'bearish', 'high', 3, 0, 'Bullish candle + doji gap + bearish candle — very strong reversal signal at the top.');

      if (isBull(c1) && isBull(c2) && isBull(c3) && c2.c > c1.c && c3.c > c2.c && body(c1) > avgBody * 0.5 && body(c2) > avgBody * 0.5 && body(c3) > avgBody * 0.5)
        push('Three White Soldiers', 'bullish', 'high', 3, 0, 'Three consecutive rising bullish candles — strong uptrend momentum.');

      if (!isBull(c1) && !isBull(c2) && !isBull(c3) && c2.c < c1.c && c3.c < c2.c && body(c1) > avgBody * 0.5 && body(c2) > avgBody * 0.5 && body(c3) > avgBody * 0.5)
        push('Three Black Crows', 'bearish', 'high', 3, 0, 'Three consecutive falling bearish candles — strong downtrend momentum.');

      if (isBull(c1) && isBull(c2) && !isBull(c3) && c3.c < c1.c && body(c3) > avgBody * 0.7)
        push('Three Inside Down', 'bearish', 'medium', 3, 0, 'Harami pattern confirmed by a strong bearish close — momentum shift to the downside.');

      if (!isBull(c1) && !isBull(c2) && isBull(c3) && c3.c > c1.c && body(c3) > avgBody * 0.7)
        push('Three Inside Up', 'bullish', 'medium', 3, 0, 'Harami pattern confirmed by a strong bullish close — momentum shift to the upside.');
    }

    return patterns;
  }

  // Aggregate detected patterns into an overall directional signal.
  function candleSignal(patterns) {
    if (!patterns.length) return { signal: 'Neutral', score: 50 };
    const w = { high: 3, medium: 2, low: 1 };
    const s = { bullish: 1, bearish: -1, neutral: 0 };
    let totalW = 0, wScore = 0;
    for (const p of patterns) {
      const wt = w[p.confidence] || 1;
      totalW += wt;
      wScore += s[p.type] * wt;
    }
    const norm = totalW > 0 ? wScore / totalW : 0;
    const score = Math.round(50 + norm * 50);
    let signal;
    if (score >= 80) signal = 'Strong Buy';
    else if (score >= 60) signal = 'Buy';
    else if (score <= 20) signal = 'Strong Sell';
    else if (score <= 40) signal = 'Sell';
    else signal = 'Neutral';
    return { signal, score };
  }

  return {
    TRADING_DAYS_YEAR,
    // core math
    dailyReturns, mean, stdev, percentile,
    // risk / portfolio
    annualizedVol, annualizedReturn, sharpeRatio, sortinoRatio, maxDrawdown, cagr, beta, correlation, riskMetrics,
    calmarRatio, treynorRatio, jensenAlpha, trackingError, informationRatio, kellyCriterion, ulcerIndex, historicalVaR, omegaRatio,
    // Monte Carlo / options
    monteCarloGBM, valueAtRisk, probAbove,
    blackScholes, normCDF, normPDF,
    // trend
    sma, ema, macd, adx, ichimoku, hullMA, zigzag, parabolicSar, fibonacci,
    // momentum
    rsi, stochastic, williamsR, cci, cmo, mfi, awesomeOscillator, rateOfChange,
    // volatility
    bollingerBands, atr, keltnerChannels, donchianChannels, chaikinVolatility, rollingStdDev, historicalVolatility, ulcerIndex,
    // volume
    obv, cmf, vwap, adLine, volumeProfile, forceIndex,
    // advanced stochastic calculus
    roughJumpDiffusion, hestonMC, calibrateHeston, malliavinGreeks, rollModel,
    // candles
    detectCandlePatterns, candleSignal,
  };
})();
