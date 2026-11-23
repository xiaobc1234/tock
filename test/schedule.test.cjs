const { test, assert } = require('./test-api.cjs')
const { minuteMs, quotaSnapshot, observe, nextCheck, nextWake, recordAttempt } = require('./schedule.cjs')

const base = 1_800_000_000_000
const fiveHours = 300 * minuteMs
const week = 10080 * minuteMs
const initial = { accountId: null, windows: {} }
const window = (minutes, resetAt, used = 1) => ({ minutes, resetAt, used })
const snapshot = (windows, accountId = 'first') => ({ accountId, windows })

test('reads the Codex bucket and requires live included-usage permission', () => {
  const result = {
    accountId: 'first', ordinaryUsageAllowed: true,
    rateLimitsByLimitId: {
      codex: { primary: { windowDurationMins: 10080, resetsAt: base / 1000, usedPercent: 0 } },
      other: { primary: { windowDurationMins: 300, resetsAt: base / 1000, usedPercent: 0 } },
    },
  }
  assert.deepEqual(quotaSnapshot(result), {
    accountId: 'first', windows: [window(10080, base, 0)], canSend: true,
  })
  for (const ordinaryUsageAllowed of [false, null, undefined]) {
    assert.equal(quotaSnapshot({ ...result, ordinaryUsageAllowed }).canSend, false)
  }
  result.rateLimitsByLimitId.codex.credits = { hasCredits: true }
  assert.equal(quotaSnapshot(result).canSend, false)
})

test('schedules only a week when only a week is reported', () => {
  const schedule = observe(initial, snapshot([window(10080, base)]), base - week)
  assert.deepEqual(nextCheck(schedule, base - 1), { at: base + minuteMs, windows: [] })
})

test('allows a first refresh with an already elapsed known boundary', () => {
  const schedule = observe(initial, snapshot([window(300, base, 0)]), base + minuteMs)
  assert.deepEqual(nextCheck(schedule, base + minuteMs), { at: base + minuteMs, windows: ['300'] })
})

test('a reset immediately before the other reset waits until both have aged a minute', () => {
  const schedule = observe(initial, snapshot([window(300, base), window(10080, base + 20_000)]), base - 1)
  const after = nextCheck(schedule, base + minuteMs)
  assert.deepEqual(after, { at: base + 20_000 + minuteMs, windows: ['300', '10080'] })
})

test('real usage of a new window cancels the pending greeting', () => {
  const schedule = observe(initial, snapshot([window(300, base)]), base - 1)
  const later = observe(schedule, snapshot([window(300, base + fiveHours, 2)]), base + minuteMs)
  assert.deepEqual(nextCheck(later, base + minuteMs), { at: base + fiveHours + minuteMs, windows: [] })
})

test('a new estimated boundary with zero recorded use keeps the previous due time', () => {
  const schedule = observe(initial, snapshot([window(300, base)]), base - 1)
  const later = observe(schedule, snapshot([window(300, base + fiveHours, 0)]), base + minuteMs)
  assert.deepEqual(nextCheck(later, base + minuteMs), { at: base + minuteMs, windows: ['300'] })
})

test('the attempt remains consumed across a restart until another window is announced', () => {
  const old = observe(initial, snapshot([window(300, base)]), base - 1)
  const update = recordAttempt(old, ['300'], base + minuteMs)
  const restart = JSON.parse(JSON.stringify(update))
  assert.equal(nextCheck(restart, base + 2 * minuteMs), null)
  const newWindow = observe(restart, snapshot([window(300, base + fiveHours, 0)]), base + 2 * minuteMs)
  assert.deepEqual(nextCheck(newWindow, base + 2 * minuteMs), { at: base + fiveHours + minuteMs, windows: [] })
})

test('switching accounts discards the old plan and its pending deadlines', () => {
  const old = observe(initial, snapshot([window(300, base)]), base - 1)
  const schedule = observe(old, snapshot([window(10080, base + week)], 'second'), base + minuteMs)
  assert.deepEqual(Object.keys(schedule.windows), ['10080'])
  assert.equal(schedule.accountId, 'second')
})

test('the next wake uses the absolute reset time plus a minute, with no periodic read', () => {
  const now = base
  const windows = [window(300, now + fiveHours), window(10080, now + week)]
  const schedule = observe(initial, snapshot(windows), now)
  assert.equal(nextWake(schedule, windows, now), now + fiveHours + minuteMs)
})

test('an exhausted weekly window delays the short window check until weekly reset', () => {
  const now = base
  const windows = [window(300, now + fiveHours), window(10080, now + week, 100)]
  const schedule = observe(initial, snapshot(windows), now)
  assert.equal(nextWake(schedule, windows, now), now + week + minuteMs)
})

test('a checked expired boundary is never polled while waiting for another one', () => {
  const now = base + minuteMs
  const windows = [window(300, base, 0), window(10080, base + week)]
  const schedule = observe(initial, snapshot(windows), now)
  assert.equal(nextWake(schedule, windows, now), base + week + minuteMs)
  assert.equal(nextWake(schedule, windows, now, true), now)
  const short = observe(initial, snapshot(windows.slice(0, 1)), now)
  assert.equal(nextWake(short, windows.slice(0, 1), now), null)
})

test('a manual send just before a reset does not delay the next automatic wake', () => {
  const now = base
  const windows = [window(300, now + 1_000)]
  const schedule = observe(initial, snapshot(windows), now)
  const afterManualSend = recordAttempt(schedule, [], now)
  assert.equal(nextWake(afterManualSend, windows, now), now + 1_000 + minuteMs)
})

test('manual refresh finds zero-use windows at the full duration with second precision', () => {
  const { unstartedWindows } = require('./schedule.cjs')
  const windows = [
    window(300, base + fiveHours, 0),
    window(10080, base + week, 0),
  ]
  const schedule = observe(initial, snapshot(windows), base)
  assert.deepEqual(unstartedWindows(schedule, windows, base + 800), ['300', '10080'])
  assert.deepEqual(unstartedWindows(schedule, windows, base + 1000), [])
  const used = windows.map((item) => ({ ...item, used: 1 }))
  assert.deepEqual(unstartedWindows(schedule, used, base), [])
})

test('weekly-only accounts are recognized and a sliding estimate cannot repeat a greeting', () => {
  const { unstartedWindows } = require('./schedule.cjs')
  const windows = [window(10080, base + week, 0)]
  const previous = observe(initial, snapshot(windows), base)
  assert.deepEqual(unstartedWindows(previous, windows, base), ['10080'])
  const attempted = recordAttempt(previous, [], base, ['10080'])
  const later = base + 20 * minuteMs
  const sliding = [window(10080, later + week, 0)]
  assert.deepEqual(unstartedWindows(observe(attempted, snapshot(sliding), later), sliding, later), [])
})
