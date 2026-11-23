const cases = []

function equal(actual, expected) {
  if (!Object.is(actual, expected)) throw new Error('Expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}

const assert = {
  equal,
  deepEqual: (actual, expected) => equal(JSON.stringify(actual), JSON.stringify(expected)),
  match: (text, pattern) => equal(pattern.test(text), true),
  doesNotMatch: (text, pattern) => equal(pattern.test(text), false),
  async rejects(promise, check) {
    try { await promise } catch (error) { equal(check(error), true); return }
    throw new Error('Expected promise to reject')
  },
}

async function run(report) {
  for (const [name, fn] of cases) {
    try {
      await fn()
      report(name, '')
    } catch (error) {
      report(name, String(error.stack ?? error))
    }
  }
  report('', '')
}

module.exports = { test: (name, fn) => cases.push([name, fn]), assert, run }
