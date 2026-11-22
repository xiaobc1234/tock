const cooldownMs = 15 * 60_000
const dayMs = 24 * 60 * 60_000
const maxDailyAttempts = 6

function attemptHistory(values, now) {
  if (!Array.isArray(values)) return []
  return values.filter((value) => Number.isFinite(value) && value > now - dayMs).sort((a, b) => a - b)
}

function nextAllowedSend(attempts, now) {
  const history = attemptHistory(attempts, now)
  const cooldownEnds = history.length > 0 ? history.at(-1) + cooldownMs : now
  const dailyLimitEnds = history.length >= maxDailyAttempts ? history.at(-maxDailyAttempts) + dayMs : now
  return Math.max(cooldownEnds, dailyLimitEnds, now)
}

module.exports = { attemptHistory, nextAllowedSend }
