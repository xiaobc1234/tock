const { test, assert } = require('./test-api.cjs')
const { restoreHistory, addGreeting, confirmGreeting } = require('./history.cjs')

test('old timestamps and interrupted attempts cannot appear as a completed greeting', () => {
  const old = restoreHistory(undefined, [100, null, 200])
  const attempted = addGreeting(old, 300, 'manual')
  const restored = restoreHistory(JSON.parse(JSON.stringify(attempted)), [])
  const result = confirmGreeting(restored, 300)
  assert.deepEqual(restored, [
    { at: 300, mode: 'manual', result: 'unknown' },
    { at: 200, mode: 'legacy', result: 'unknown' },
    { at: 100, mode: 'legacy', result: 'unknown' },
  ])
  assert.deepEqual(result.map(({ result }) => result), ['sent', 'unknown', 'unknown'])
})

test('history retains the 50 most recent attempts', () => {
  let entries = []
  for (let time = 1; time <= 55; time++) entries = addGreeting(entries, time, 'automatic')
  assert.equal(entries.length, 50)
  assert.equal(entries[0].at, 55)
  assert.equal(entries.at(-1).at, 6)
})
