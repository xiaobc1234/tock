const { test, assert } = require('./test-api.cjs')
const { Codex, RpcError } = require('./codex.cjs')
const { translate } = require('./i18n.js')

function fakeCodex(...responses) {
  const client = new Codex()
  client.connect = async () => {}
  let reads = 0
  client.call = async (method) => {
    if (method === 'account/read') return { account: { type: 'chatgpt', email: 'me@example.test', planType: 'plus' } }
    assert.equal(method, 'account/rateLimits/read')
    const result = responses[reads++]
    if (result instanceof Error) throw result
    return result
  }
  return { client, reads: () => reads }
}

test('quota lookup retries a transient failure once, without sending a model message', async () => {
  const unavailable = new RpcError('quotaReadFailed', { message: 'Unexpected HTTP status 503: request unavailable' })
  const { client, reads } = fakeCodex(unavailable, { accountId: 'test', rateLimits: {} })
  assert.equal((await client.readQuota()).accountId, 'test')
  assert.equal(reads(), 2)
})

test('expired login is explained without a retry or raw service response', async () => {
  const rejected = new RpcError('quotaReadFailed', {
    message: 'Unexpected status 401 Unauthorized, token_revoked with private details',
  })
  const { client, reads } = fakeCodex(rejected)
  await assert.rejects(client.readQuota(), (error) => {
    assert.equal(error.key, 'quotaAuth')
    for (const [language, expected] of [['zh-CN', /登录已失效/], ['en-US', /sign-in expired/]]) {
      const message = translate(language, error.key, error.status)
      assert.match(message, expected)
      assert.match(message, /HTTP 401/)
      assert.doesNotMatch(message, /private|token_revoked/)
    }
    assert.equal(error.accountConnected, false)
    return true
  })
  assert.equal(reads(), 1)
})

test('a failed transient retry still identifies the connected account', async () => {
  const error = new RpcError('quotaReadFailed', { message: 'request timed out' })
  const { client, reads } = fakeCodex(error, error)
  await assert.rejects(client.readQuota(), (error) => {
    assert.equal(error.key, 'quotaTimeout')
    assert.equal(error.connectedAccount, 'me@example.test')
    assert.equal(error.accountConnected, true)
    return true
  })
  assert.equal(reads(), 2)
})
