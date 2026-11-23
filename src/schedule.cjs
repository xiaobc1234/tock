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
    ? { ...previous, windows: { ...previous.windows }, startedAt: { ...previous.startedAt } }
    : { accountId: snapshot.accountId, windows: {}, startedAt: {} }

  for (const window of snapshot.windows) {
    if (window.used > 0) delete schedule.startedAt[window.minutes]
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

function unstartedWindows(schedule, windows, checkedAt) {
  return windows.filter(({ minutes, resetAt, used }) => {
    const duration = minutes * minuteMs
    // The API sends whole-second timestamps. Compare at the precision of the response,
    // using the start of the read so transport delays don't shorten the window.
    const readTime = Math.floor(checkedAt / 1000) * 1000
    const last = schedule.startedAt?.[minutes]
    return used === 0 && resetAt && resetAt - readTime >= duration
      && (!last || readTime - last >= duration)
  }).map(({ minutes }) => String(minutes))
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

function nextWake(schedule, windows, now, includeDue = false) {
  const pending = nextCheck(schedule, now)
  if (!pending) return null
  const exhausted = windows.filter(({ used }) => used >= 100)
  if (exhausted.some(({ resetAt }) => !resetAt)) return null

  const at = Math.max(pending.at, ...exhausted.map(({ resetAt }) => resetAt + minuteMs))
  if (at > now || includeDue) return at

  // This boundary was just checked. Wait for a later known boundary instead
  // of repeatedly querying the same expired one.
  const upcoming = Object.values(schedule.windows)
    .filter(({ resetAt, attempted }) => !attempted && resetAt + minuteMs > now)
    .map(({ resetAt }) => resetAt + minuteMs)
  return upcoming.length ? Math.min(...upcoming) : null
}

function recordAttempt(schedule, minutes, now, starting = []) {
  const windows = { ...schedule.windows }
  const startedAt = { ...schedule.startedAt }
  for (const duration of minutes) windows[duration] = { ...windows[duration], attempted: true }
  for (const duration of starting) startedAt[duration] = now
  return { ...schedule, windows, startedAt }
}

module.exports = { minuteMs, quotaSnapshot, observe, unstartedWindows, nextCheck, nextWake, recordAttempt }
