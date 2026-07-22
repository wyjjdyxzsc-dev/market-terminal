(function initCandleAnalysis(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MarketTerminalCandleAnalysis = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function candleAnalysisFactory() {
  function roundPrice(value) {
    return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
  }

  function priceTolerance(price) {
    return Math.max((Math.abs(price) || 100) * 0.0025, 0.25);
  }

  function body(candle) {
    return Math.abs(candle.c - candle.o);
  }

  function range(candle) {
    return candle.h - candle.l || 0.0001;
  }

  function isBull(candle) {
    return candle.c >= candle.o;
  }

  function upperShadow(candle) {
    return candle.h - Math.max(candle.o, candle.c);
  }

  function lowerShadow(candle) {
    return Math.min(candle.o, candle.c) - candle.l;
  }

  function detectCandlePatterns(candles) {
    const patterns = [];
    const n = candles.length;
    if (n < 1) return patterns;

    const avgBody = candles.reduce((sum, candle) => sum + body(candle), 0) / n || 0.0001;
    const push = (name, type, confidence, candlesInvolved, candleIndex, description) => {
      patterns.push({ name, type, confidence, candlesInvolved, candleIndex, description });
    };

    const cur = candles[n - 1];
    const curBody = body(cur);
    const curRange = range(cur);

    if (curBody / curRange < 0.1) {
      push('Doji', 'neutral', 'medium', 1, 0, 'Tiny body signals indecision; watch for a break in either direction.');
    }

    if (curBody > 0 && lowerShadow(cur) >= 2 * curBody && upperShadow(cur) <= 0.15 * curRange) {
      const downtrend = n >= 5 && cur.c < candles[n - 5].c;
      push(
        downtrend ? 'Hammer' : 'Hanging Man',
        downtrend ? 'bullish' : 'bearish',
        'medium',
        1,
        0,
        downtrend
          ? 'Long lower wick after a decline suggests sellers were rejected.'
          : 'Long lower wick near highs can indicate late-session distribution.'
      );
    }

    if (curBody > 0 && upperShadow(cur) >= 2 * curBody && lowerShadow(cur) <= 0.15 * curRange) {
      const uptrend = n >= 5 && cur.c > candles[n - 5].c;
      push(
        uptrend ? 'Shooting Star' : 'Inverted Hammer',
        uptrend ? 'bearish' : 'bullish',
        'medium',
        1,
        0,
        uptrend
          ? 'Long upper wick shows rejection near the highs.'
          : 'Inverted hammer after a decline can precede bullish follow-through.'
      );
    }

    if (curBody / curRange > 0.95) {
      push(
        isBull(cur) ? 'Bullish Marubozu' : 'Bearish Marubozu',
        isBull(cur) ? 'bullish' : 'bearish',
        'high',
        1,
        0,
        isBull(cur)
          ? 'Buyers controlled the entire candle.'
          : 'Sellers controlled the entire candle.'
      );
    }

    if (curBody / curRange < 0.25 && Math.abs(upperShadow(cur) - lowerShadow(cur)) < curRange * 0.2 && curBody / curRange >= 0.1) {
      push('Spinning Top', 'neutral', 'low', 1, 0, 'Small body with balanced shadows suggests indecision.');
    }

    if (n >= 2) {
      const prev = candles[n - 2];

      if (!isBull(prev) && isBull(cur) && cur.o < prev.c && cur.c > prev.o && body(cur) > body(prev)) {
        push('Bullish Engulfing', 'bullish', 'high', 2, 0, 'Bullish candle fully engulfs the prior bearish body.');
      }

      if (isBull(prev) && !isBull(cur) && cur.o > prev.c && cur.c < prev.o && body(cur) > body(prev)) {
        push('Bearish Engulfing', 'bearish', 'high', 2, 0, 'Bearish candle fully engulfs the prior bullish body.');
      }

      if (!isBull(prev) && isBull(cur) && cur.o > prev.c && cur.c < prev.o && body(cur) < body(prev) * 0.5) {
        push('Bullish Harami', 'bullish', 'medium', 2, 0, 'Small bullish body inside a larger bearish candle suggests selling pressure is fading.');
      }

      if (isBull(prev) && !isBull(cur) && cur.o < prev.c && cur.c > prev.o && body(cur) < body(prev) * 0.5) {
        push('Bearish Harami', 'bearish', 'medium', 2, 0, 'Small bearish body inside a larger bullish candle suggests buying pressure is fading.');
      }

      if (isBull(prev) && !isBull(cur) && cur.o > prev.h && cur.c < (prev.o + prev.c) / 2 && body(cur) > avgBody * 0.5) {
        push('Dark Cloud Cover', 'bearish', 'high', 2, 0, 'Gap higher followed by a close back through the prior body is a classic bearish reversal.');
      }

      if (!isBull(prev) && isBull(cur) && cur.o < prev.l && cur.c > (prev.o + prev.c) / 2 && body(cur) > avgBody * 0.5) {
        push('Piercing Line', 'bullish', 'high', 2, 0, 'Gap lower followed by a close back through the prior body is a classic bullish reversal.');
      }

      if (isBull(prev) && !isBull(cur) && Math.abs(prev.h - cur.h) < range(prev) * 0.02) {
        push('Tweezer Top', 'bearish', 'medium', 2, 0, 'Matching highs can mark a resistance shelf.');
      }

      if (!isBull(prev) && isBull(cur) && Math.abs(prev.l - cur.l) < range(prev) * 0.02) {
        push('Tweezer Bottom', 'bullish', 'medium', 2, 0, 'Matching lows can mark a support shelf.');
      }
    }

    if (n >= 3) {
      const c1 = candles[n - 3];
      const c2 = candles[n - 2];
      const c3 = candles[n - 1];

      if (!isBull(c1) && body(c2) < avgBody * 0.4 && isBull(c3) && c3.c > (c1.o + c1.c) / 2) {
        push('Morning Star', 'bullish', 'high', 3, 0, 'Three-candle bullish reversal sequence.');
      }

      if (isBull(c1) && body(c2) < avgBody * 0.4 && !isBull(c3) && c3.c < (c1.o + c1.c) / 2) {
        push('Evening Star', 'bearish', 'high', 3, 0, 'Three-candle bearish reversal sequence.');
      }

      if (!isBull(c1) && body(c2) / range(c2) < 0.1 && isBull(c3) && c3.c > (c1.o + c1.c) / 2) {
        push('Morning Doji Star', 'bullish', 'high', 3, 0, 'Doji interruption followed by a bullish reclaim is a strong reversal pattern.');
      }

      if (isBull(c1) && body(c2) / range(c2) < 0.1 && !isBull(c3) && c3.c < (c1.o + c1.c) / 2) {
        push('Evening Doji Star', 'bearish', 'high', 3, 0, 'Doji interruption followed by a bearish rejection is a strong reversal pattern.');
      }

      if (isBull(c1) && isBull(c2) && isBull(c3) && c2.c > c1.c && c3.c > c2.c && body(c1) > avgBody * 0.5 && body(c2) > avgBody * 0.5 && body(c3) > avgBody * 0.5) {
        push('Three White Soldiers', 'bullish', 'high', 3, 0, 'Three consecutive strong bullish candles confirm upward momentum.');
      }

      if (!isBull(c1) && !isBull(c2) && !isBull(c3) && c2.c < c1.c && c3.c < c2.c && body(c1) > avgBody * 0.5 && body(c2) > avgBody * 0.5 && body(c3) > avgBody * 0.5) {
        push('Three Black Crows', 'bearish', 'high', 3, 0, 'Three consecutive strong bearish candles confirm downward momentum.');
      }

      if (isBull(c1) && isBull(c2) && !isBull(c3) && c3.c < c1.c && body(c3) > avgBody * 0.7) {
        push('Three Inside Down', 'bearish', 'medium', 3, 0, 'Bullish structure failed and rolled over with confirmation.');
      }

      if (!isBull(c1) && !isBull(c2) && isBull(c3) && c3.c > c1.c && body(c3) > avgBody * 0.7) {
        push('Three Inside Up', 'bullish', 'medium', 3, 0, 'Bearish structure failed and reversed with confirmation.');
      }
    }

    return patterns;
  }

  function candleSignal(patterns) {
    if (!patterns.length) return { signal: 'Neutral', score: 50 };
    const confidenceWeight = { high: 3, medium: 2, low: 1 };
    const directionWeight = { bullish: 1, bearish: -1, neutral: 0 };
    let totalWeight = 0;
    let weightedScore = 0;
    for (const pattern of patterns) {
      const weight = confidenceWeight[pattern.confidence] || 1;
      totalWeight += weight;
      weightedScore += (directionWeight[pattern.type] || 0) * weight;
    }
    const normalized = totalWeight > 0 ? weightedScore / totalWeight : 0;
    const score = Math.round(50 + normalized * 50);
    let signal = 'Neutral';
    if (score >= 80) signal = 'Strong Buy';
    else if (score >= 60) signal = 'Buy';
    else if (score <= 20) signal = 'Strong Sell';
    else if (score <= 40) signal = 'Sell';
    return { signal, score };
  }

  function inferTrend(candles) {
    if (candles.length < 2) return 'Sideways';
    const lookback = candles.slice(-Math.min(candles.length, 20));
    const start = lookback[0].c;
    const end = lookback[lookback.length - 1].c;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start === 0) return 'Sideways';
    const changePct = ((end - start) / start) * 100;
    if (changePct >= 1.5) return 'Uptrend';
    if (changePct <= -1.5) return 'Downtrend';
    return 'Sideways';
  }

  function inferMomentum(candles) {
    if (candles.length < 4) return 'Neutral';
    const a = candles[candles.length - 1].c - candles[candles.length - 2].c;
    const b = candles[candles.length - 2].c - candles[candles.length - 3].c;
    const c = candles[candles.length - 3].c - candles[candles.length - 4].c;
    const sameDirection = Math.sign(a) !== 0 && Math.sign(a) === Math.sign(b);
    if (!sameDirection) return 'Neutral';
    const latestMagnitude = Math.abs(a);
    const priorMagnitude = (Math.abs(b) + Math.abs(c)) / 2;
    if (latestMagnitude > priorMagnitude * 1.1) return 'Accelerating';
    if (latestMagnitude < priorMagnitude * 0.9) return 'Decelerating';
    return 'Neutral';
  }

  function distinctLevels(values, currentPrice, direction) {
    const tolerance = priceTolerance(currentPrice);
    const picked = [];
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      if (picked.some((existing) => Math.abs(existing - value) <= tolerance)) continue;
      picked.push(value);
      if (picked.length === 3) break;
    }
    return picked.map(roundPrice).filter((value) => value != null);
  }

  function inferKeyLevels(candles, currentPrice) {
    const lows = candles
      .map((candle) => candle.l)
      .filter((value) => Number.isFinite(value) && (!Number.isFinite(currentPrice) || value <= currentPrice))
      .sort((a, b) => Math.abs(currentPrice - a) - Math.abs(currentPrice - b));
    const highs = candles
      .map((candle) => candle.h)
      .filter((value) => Number.isFinite(value) && (!Number.isFinite(currentPrice) || value >= currentPrice))
      .sort((a, b) => Math.abs(currentPrice - a) - Math.abs(currentPrice - b));

    let support = distinctLevels(lows, currentPrice, 'support');
    let resistance = distinctLevels(highs, currentPrice, 'resistance');

    if (!support.length) {
      support = distinctLevels(candles.map((candle) => candle.l).sort((a, b) => b - a), currentPrice, 'support');
    }
    if (!resistance.length) {
      resistance = distinctLevels(candles.map((candle) => candle.h).sort((a, b) => a - b), currentPrice, 'resistance');
    }

    return { support, resistance };
  }

  function inferRecommendation(signal, keyLevels, currentPrice) {
    const nearestResistance = keyLevels.resistance[0];
    const nearestSupport = keyLevels.support[0];
    if (signal === 'Strong Buy' || signal === 'Buy') {
      if (nearestResistance != null) {
        return `The observed pattern remains constructive above ${nearestSupport != null ? `$${nearestSupport}` : 'recent support'}; a close above $${nearestResistance} would confirm continuation.`;
      }
      return 'The observed pattern is constructive, but no continuation is confirmed without another supportive close.';
    }
    if (signal === 'Strong Sell' || signal === 'Sell') {
      if (nearestSupport != null) {
        return `A close below $${nearestSupport} would confirm that the observed downside pattern remains active.`;
      }
      return 'The observed pattern is bearish; a reclaim of resistance would invalidate that technical description.';
    }
    if (nearestSupport != null && nearestResistance != null) {
      return `Neutral setup for now; watch the ${Number.isFinite(currentPrice) ? `current range between $${nearestSupport} and $${nearestResistance}` : 'nearest support/resistance band'} for the next directional break.`;
    }
    return 'The observed setup is neutral until the price series records a decisive break in either direction.';
  }

  function inferSummary(patterns, trend, momentum, signal, meta = {}) {
    const leadPattern = patterns[0];
    const clauses = [];
    if (leadPattern) {
      clauses.push(`${leadPattern.name} is the clearest recent pattern`);
    } else {
      clauses.push('No high-conviction candlestick pattern stands out');
    }
    clauses.push(`${trend.toLowerCase()} conditions are in place`);
    clauses.push(`short-term momentum is ${momentum.toLowerCase()}`);
    let summary = `${clauses.join(', ')}. Overall signal sits at ${signal}.`;
    if (meta.degraded && meta.degradeReason) {
      summary += ` Note: ${meta.degradeReason}.`;
    }
    return summary;
  }

  function buildDeterministicCandleAnalysis(candles, options = {}) {
    const cleanCandles = (candles || []).filter((candle) =>
      Number.isFinite(candle?.o) &&
      Number.isFinite(candle?.h) &&
      Number.isFinite(candle?.l) &&
      Number.isFinite(candle?.c)
    );
    const patterns = detectCandlePatterns(cleanCandles);
    const { signal, score } = candleSignal(patterns);
    const trend = inferTrend(cleanCandles);
    const momentum = inferMomentum(cleanCandles);
    const currentPrice = Number.isFinite(options.currentPrice)
      ? options.currentPrice
      : cleanCandles[cleanCandles.length - 1]?.c;
    const keyLevels = inferKeyLevels(cleanCandles.slice(-40), currentPrice);
    return {
      patterns,
      overallSignal: signal,
      signalStrength: score,
      keyLevels,
      trend,
      momentum,
      summary: inferSummary(patterns, trend, momentum, signal, options),
      recommendation: inferRecommendation(signal, keyLevels, currentPrice),
    };
  }

  return {
    detectCandlePatterns,
    candleSignal,
    inferTrend,
    inferMomentum,
    inferKeyLevels,
    buildDeterministicCandleAnalysis,
  };
}));
