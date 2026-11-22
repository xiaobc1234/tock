const minuteMs = 60_000

function quotaSnapshot(result) {
  const bucket = result.rateLimitsByLimitId?.codex
    ?? (result.rateLimits?.limitId === 'codex' ? result.rateLimits : undefined)
  const windows = [bucket?.primary, bucket?.secondary]
    .filter((window) => window && [300, 10080].includes(window.windowDurationMins))
    .map((window) => ({
      minutes: window.windowDurationMins,
      resetAt: Number.isSafeInteger(window.resetsAt) && window.resetsAt > 0
        ? window.resetsAt * 1000 : null,
      used: window.usedPercent,
    }))
  return {
    accountId: typeof result.accountId === 'string' && result.accountId ? result.accountId : null,
    windows,
    canSend: result.ordinaryUsageAllowed === true
      && windows.length > 0
      && windows.every((window) => Number.isFinite(window.used) && window.used < 100)
      && bucket?.credits?.hasCredits !== true
      && bucket?.credits?.unlimited !== true,
  }
}

function observe(previous, snapshot, now) {
  const sameAccount = snapshot.accountId && previous.accountId === snapshot.accountId
  const schedule = sameAccount
    ? { ...previous, windows: { ...previous.windows } }
    : { accountId: snapshot.accountId, windows: {} }

  for (const window of snapshot.windows) {
    const old = schedule.windows[window.minutes]
    if (!window.resetAt) continue
    if (old?.resetAt === window.resetAt) continue
    // A reset time may change while the new window still has no recorded use.
    // Keep the previous due time until a request is attempted or real use is observed.
    if (old && old.resetAt <= now && !old.attempted && window.used === 0) continue
    if (!old || window.resetAt > now) schedule.windows[window.minutes] = { resetAt: window.resetAt }
  }

  // An absent window can be either unstarted or unavailable. Only retain an
  // already observed boundary if this account still exposes that window.
  for (const minutes of Object.keys(schedule.windows)) {
    if (!snapshot.windows.some((window) => window.minutes === Number(minutes))) {
      delete schedule.windows[minutes]
    }
  }
  return schedule
}

function nextCheck(schedule, now) {
  const windows = Object.entries(schedule.windows).filter(([, window]) => !window.attempted)
  const ended = windows.filter(([, window]) => window.resetAt <= now)
  if (ended.length > 0) {
    return {
      at: Math.max(...ended.map(([, window]) => window.resetAt)) + minuteMs,
      windows: ended.map(([minutes]) => minutes),
    }
  }
  if (windows.length === 0) return null
  const at = Math.min(...windows.map(([, window]) => window.resetAt)) + minuteMs
  return { at, windows: [] }
}

function nextWake(schedule, windows, allowedAt, now, includeDue = false) {
  const pending = nextCheck(schedule, now)
  if (!pending) return null
  const exhausted = windows.filter(({ used }) => used >= 100)
  if (exhausted.some(({ resetAt }) => !resetAt)) return null

  const availableAt = Math.max(allowedAt, ...exhausted.map(({ resetAt }) => resetAt + minuteMs))
  const at = Math.max(pending.at, availableAt)
  if (at > now || includeDue) return at

  // This boundary was just checked. Wait for a later known boundary instead
  // of repeatedly querying the same expired one.
  const upcoming = Object.values(schedule.windows)
    .filter(({ resetAt, attempted }) => !attempted && resetAt + minuteMs > now)
    .map(({ resetAt }) => resetAt + minuteMs)
  return upcoming.length ? Math.min(...upcoming) : null
}

function recordAttempt(schedule, minutes, now) {
  const windows = { ...schedule.windows }
  for (const duration of minutes) windows[duration] = { ...windows[duration], attempted: true }
  return { ...schedule, windows, lastAttempt: now }
}

module.exports = { minuteMs, quotaSnapshot, observe, nextCheck, nextWake, recordAttempt }
