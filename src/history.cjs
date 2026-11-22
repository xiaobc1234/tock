const historyLimit = 50

function restoreHistory(records, previousAttempts) {
  const saved = Array.isArray(records)
    ? records
    : previousAttempts.map((at) => ({ at, mode: 'legacy', result: 'unknown' }))
  return saved.filter((entry) => Number.isFinite(entry?.at)).slice(0, historyLimit)
}

function addGreeting(records, at, mode) {
  return [{ at, mode, result: 'unknown' }, ...records].slice(0, historyLimit)
}

function confirmGreeting(records, at) {
  return records.map((entry) => entry.at === at ? { ...entry, result: 'sent' } : entry)
}

module.exports = { restoreHistory, addGreeting, confirmGreeting }
