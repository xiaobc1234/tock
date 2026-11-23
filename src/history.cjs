const historyLimit = 50

function restoreHistory(records, previousAttempts) {
  if (Array.isArray(records)) {
    return records.filter((entry) => Number.isFinite(entry?.at)).slice(0, historyLimit)
  }
  if (!Array.isArray(previousAttempts)) return []
  return previousAttempts.filter(Number.isFinite).sort((a, b) => b - a).slice(0, historyLimit)
    .map((at) => ({ at, mode: 'legacy', result: 'unknown' }))
}

function addGreeting(records, at, mode) {
  return [{ at, mode, result: 'unknown' }, ...records].slice(0, historyLimit)
}

function confirmGreeting(records, at) {
  return records.map((entry) => entry.at === at ? { ...entry, result: 'sent' } : entry)
}

module.exports = { restoreHistory, addGreeting, confirmGreeting }
