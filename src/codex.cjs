const { Emitter, host } = require('./host.cjs')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const requestTimeout = 15_000
const preferredModels = new Map([
  ['gpt-6-luna', 'GPT-6 Luna'],
  ['gpt-5.6-luna', 'GPT-5.6 Luna'],
])

class CodexError extends Error {
  constructor(key, status) {
    super(key)
    this.key = key
    this.status = status
  }
}

class RpcError extends CodexError {
  constructor(key, details = {}) {
    const text = String(details.message ?? '')
    const status = text.match(/(?:status(?:\s+code)?\s*[:=]?\s*|HTTP(?:\/\d(?:\.\d)?)?\s+|\()([45]\d{2})\b/i)
      ?? text.match(/\b(401|403|407|408|429|500|502|503|504)\s+(?:Unauthorized|Forbidden|Proxy Authentication|Request Timeout|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i)
    super(key, status ? Number(status[1]) : undefined)
    if (this.status === 401 || /token_revoked|token_invalidated|invalidated oauth|invalid_grant|chatgpt authentication required|codex account authentication required/i.test(text)) {
      this.kind = 'auth'
    } else if (/cloudflare|just a moment|challenge-platform/i.test(text)) {
      this.kind = 'challenge'
    } else if (this.status === 403 || this.status === 407 || /network permission was revoked/i.test(text)) {
      this.kind = 'access'
    } else if (details.code === -32601 || this.status === 404) {
      this.kind = 'unsupported'
    } else if (/certificate|unknown issuer|invalid peer/i.test(text)) {
      this.kind = 'certificate'
    } else if (this.status === 408 || /timed out|timeout/i.test(text)) {
      this.kind = 'timeout'
    } else if (this.status === 429 || this.status >= 500) {
      this.kind = 'service'
    } else if (/error sending request|failed to send|dns|connection refused|connection reset|connection closed|network is unreachable/i.test(text)) {
      this.kind = 'network'
    } else {
      this.kind = details.kind ?? 'unknown'
    }
  }
}

const quotaErrorKeys = {
  auth: 'quotaAuth',
  challenge: 'quotaChallenge',
  access: 'quotaAccess',
  unsupported: 'quotaUnsupported',
  certificate: 'quotaCertificate',
  timeout: 'quotaTimeout',
  service: 'quotaService',
  network: 'quotaNetwork',
}

class Codex extends Emitter {
  constructor(binary, cwd) {
    super()
    this.binary = binary
    this.cwd = cwd
    this.requests = new Map()
    this.sequence = 0
  }

  async connect() {
    if (this.connection) return this.connection
    let child
    const disconnect = () => {
      if (this.child !== child) return
      this.child = null
      this.connection = null
      this.loginId = null
      host.kill(child)
      for (const request of this.requests.values()) {
        request.reject(new CodexError('codexDisconnected'))
      }
      this.emit('disconnected')
    }
    this.disconnect = disconnect
    child = host.spawn(this.binary, ['app-server', '--stdio', '-c', 'model_provider="openai"'], this.cwd, (event, line) => {
      if (this.child !== child) return
      if (event === 'exit') { disconnect(); return }
      let message
      try { message = JSON.parse(line) } catch { return }
      if (message.method) {
        if (message.id !== undefined) {
          this.write({ id: message.id, error: { code: -32601, message: 'Client method unavailable' } })
          return
        }
        this.emit(message.method, message.params)
        return
      }
      const request = this.requests.get(message.id)
      if (!request) return
      if (message.error) request.reject(new RpcError(request.failure, message.error))
      else request.resolve(message.result)
    })

    this.child = child
    this.connection = this.call('initialize', {
      clientInfo: { name: 'tock', version: host.version },
    }, 'cliStartFailed').then(() => this.write({ method: 'initialized' })).catch((error) => {
      disconnect()
      throw error
    })
    return this.connection
  }

  write(value) {
    if (!this.child) throw new CodexError('codexUnavailable')
    host.write(this.child, JSON.stringify(value) + '\n')
  }

  call(method, params, failure = 'codexRequestFailed') {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(reject, new RpcError('codexTimedOut', { kind: 'timeout' })), requestTimeout)
      const finish = (notify, value) => {
        clearTimeout(timer)
        this.requests.delete(id)
        notify(value)
      }
      this.requests.set(id, {
        failure,
        resolve: (value) => finish(resolve, value),
        reject: (error) => finish(reject, error),
      })
      try { this.write({ method, id, params }) } catch (error) { finish(reject, error) }
    })
  }

  async readQuota({ fresh = false } = {}) {
    if (fresh) this.stop()
    await this.connect()
    const { account } = await this.call('account/read', { refreshToken: false }, 'accountCheckFailed')
      .catch((error) => {
        if (error.kind === 'auth') throw new CodexError('quotaAuth', error.status)
        throw error
      })
    if (account?.type !== 'chatgpt') return null
    const read = () => this.call('account/rateLimits/read', undefined, 'quotaReadFailed')
    let limits
    try {
      try {
        limits = await read()
      } catch (error) {
        if (!(error instanceof RpcError) || !['timeout', 'service', 'network', 'unknown'].includes(error.kind)) throw error
        await wait(700)
        limits = await read()
      }
    } catch (error) {
      const key = Object.hasOwn(quotaErrorKeys, error.kind) ? quotaErrorKeys[error.kind] : 'quotaUnknown'
      const failure = new CodexError(key, error.status)
      failure.connectedAccount = error.kind === 'auth' ? null : account.email
      failure.accountConnected = error.kind !== 'auth'
      throw failure
    }
    return { ...limits, email: account.email, plan: account.planType }
  }

  async login(openBrowser) {
    await this.connect()
    const result = await this.call('account/login/start', {
      type: 'chatgpt', useHostedLoginSuccessPage: true, appBrand: 'codex',
    }, 'loginOpenFailed')
    this.loginId = result.loginId
    try {
      await openBrowser(result.authUrl)
    } catch {
      await this.cancelLogin().catch(() => {})
      throw new CodexError('loginOpenFailed')
    }
  }

  async cancelLogin() {
    if (!this.loginId) return
    const loginId = this.loginId
    this.loginId = null
    await this.call('account/login/cancel', { loginId })
  }

  async greetingModel() {
    let cursor = null
    const models = new Map()
    do {
      const page = await this.call('model/list', { cursor, limit: 50, includeHidden: false })
      for (const model of page.data) models.set(model.model, model)
      cursor = page.nextCursor
    } while (cursor)
    const model = [...preferredModels.keys()].map((id) => models.get(id)).find(Boolean)
    if (!model) return null
    const supported = model.supportedReasoningEfforts?.map((item) => item.reasoningEffort) ?? []
    const effort = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].find((value) => supported.includes(value))
      ?? model.defaultReasoningEffort
    return { id: model.model, name: preferredModels.get(model.model), effort }
  }

  async prepareGreeting(model) {
    const { thread } = await this.call('thread/start', {
      model: model.id,
      modelProvider: 'openai',
      cwd: this.cwd,
      ephemeral: true,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      serviceTier: 'default',
      baseInstructions: 'Reply with exactly 你好. Do not use tools.',
      developerInstructions: '',
      config: { web_search: 'disabled', mcp_servers: {}, plugins: {} },
    }, 'greetingSetupFailed')
    return { id: thread.id, effort: model.effort }
  }

  async greet(thread) {
    let resolveTurn
    const completed = new Promise((resolve) => { resolveTurn = resolve })
    const onCompleted = (event) => {
      if (event.threadId === thread.id) resolveTurn(event.turn.status === 'completed')
    }
    const onDisconnect = () => resolveTurn(false)
    this.on('turn/completed', onCompleted)
    this.once('disconnected', onDisconnect)
    const timer = setTimeout(onDisconnect, 40_000)
    try {
      const { turn } = await this.call('turn/start', {
        threadId: thread.id,
        input: [{ type: 'text', text: '请只回复：你好' }],
        effort: thread.effort,
        serviceTierForTurn: 'default',
      }, 'greetingUnconfirmed')
      if (turn.status === 'completed') return true
      if (turn.status !== 'inProgress') return false
      return await completed
    } finally {
      clearTimeout(timer)
      this.off('turn/completed', onCompleted)
      this.off('disconnected', onDisconnect)
    }
  }

  stop() {
    if (this.child) this.disconnect()
  }
}

module.exports = { Codex, CodexError, RpcError }
