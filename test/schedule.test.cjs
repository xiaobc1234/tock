const { test } = require('node:test')
const assert = require('node:assert/strict')
const { minuteMs, quotaSnapshot, observe, nextCheck, nextWake, recordAttempt } = require('../src/schedule.cjs')

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
  assert.equal(nextWake(schedule, windows, now, now), now + fiveHours + minuteMs)
})

test('an exhausted weekly window delays the short window check until weekly reset', () => {
  const now = base
  const windows = [window(300, now + fiveHours), window(10080, now + week, 100)]
  const schedule = observe(initial, snapshot(windows), now)
  assert.equal(nextWake(schedule, windows, now, now), now + week + minuteMs)
})

test('a checked expired boundary is never polled while waiting for another one', () => {
  const now = base + minuteMs
  const windows = [window(300, base, 0), window(10080, base + week)]
  const schedule = observe(initial, snapshot(windows), now)
  assert.equal(nextWake(schedule, windows, now, now), base + week + minuteMs)
  assert.equal(nextWake(schedule, windows, now, now, true), now)
  const short = observe(initial, snapshot(windows.slice(0, 1)), now)
  assert.equal(nextWake(short, windows.slice(0, 1), now, now), null)
})

test('a future cooldown moves the wake time without any intermediate quota read', () => {
  const now = base
  const windows = [window(300, now - minuteMs)]
  const schedule = observe(initial, snapshot(windows), now)
  assert.equal(nextWake(schedule, windows, now + 15 * minuteMs, now), now + 15 * minuteMs)
})
