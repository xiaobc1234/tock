const { host, events, handle, displays, nearestDisplay, setupTray } = require('./host.cjs')
const { Codex, CodexError } = require('./codex.cjs')
const { languages, normalizeLanguage, translate } = require('./i18n.js')
const { quotaSnapshot, observe, unstartedWindows, nextCheck, nextWake, recordAttempt } = require('./schedule.cjs')
const { restoreHistory, addGreeting, confirmGreeting } = require('./history.cjs')
const { edges, dockBounds, nearestDock } = require('./dock.cjs')
const maxTimerDelay = 2_147_483_647

function readSettings(path) {
  try {
    return host.exists(path) ? JSON.parse(host.readFile(path)) ?? {} : {}
  } catch (error) {
    console.error('Could not read Tock settings')
    return {}
  }
}

function accountKey(response) {
  if (!response?.accountId) return null
  return host.sha256(JSON.stringify([response.accountId, response.email ?? null]))
}

function start() {
  const dataDir = host.path('userData')
  host.mkdir(dataDir)
  const settingsPath = host.join(dataDir, 'settings.json')
  const legacyPath = host.join(host.path('appData'), 'Codex 周期', 'settings.json')
  const saved = readSettings(host.exists(settingsPath) ? settingsPath : legacyPath)
  let settings = {
    language: normalizeLanguage(saved.language),
    edge: edges.includes(saved.edge) ? saved.edge : 'right',
    collapsed: saved.collapsed === true,
    anchor: Number.isFinite(saved.anchor) ? Math.min(Math.max(saved.anchor, 0), 1) : 0.42,
    displayId: saved.displayId,
    autoEnabled: saved.autoEnabled === true || (saved.autoEnabled === undefined && Boolean(saved.autoAccount)),
    schedules: saved.schedules ?? {},
    legacySchedule: saved.legacySchedule ?? saved.schedule,
    history: restoreHistory(saved.history, saved.attempts ?? [saved.schedule?.lastAttempt]),
  }
  const scratch = host.mkdtemp(host.join(host.path('temp'), 'tock-'))
  const binary = host.findCodex()
  const codex = binary ? new Codex(binary, scratch) : null
  let quota = null
  let quotaReadAt = 0
  let connectedAccount = null
  let accountConnected = false
  let selectedModel = null
  let viewStatus = 'readingTimes'
  let viewNote = ''
  let needsLogin = false
  let loginPending = false
  let busy = false
  let quitting = false
  let autoTimer
  let settleTimer
  let nextSend = null
  let drag
  let dockDisplay = displays().find(({ id }) => id === settings.displayId)
    ?? nearestDisplay(JSON.parse(host.cursor()))
  const t = (key, status) => translate(settings.language, key, status)

  function updateSettings(changes) {
    const next = { ...settings, ...changes }
    if (JSON.stringify(next) === JSON.stringify(settings) && host.exists(settingsPath)) return
    const temporary = settingsPath + '.tmp'
    host.writeFile(temporary, JSON.stringify(next))
    host.rename(temporary, settingsPath)
    settings = next
  }

  function currentSchedule() {
    return settings.schedules[quota?.accountId] ?? { accountId: quota?.accountId, windows: {} }
  }

  function publish() {
    host.snapshot(JSON.stringify({
      language: settings.language,
      windows: quota?.windows.map(({ minutes, resetAt }) => ({ minutes, resetAt })) ?? [],
      hasQuota: Boolean(quota),
      weeklyOnly: quota?.windows.length === 1 && quota.windows[0].minutes === 10080,
      account: connectedAccount,
      accountConnected,
      accountKnown: Boolean(quota?.accountId),
      nextSend,
      history: settings.history,
      automatic: settings.autoEnabled,
      canSend: Boolean(quota?.canSend && quota?.accountId && selectedModel && !busy),
      model: selectedModel ? { name: selectedModel.name, effort: selectedModel.effort } : null,
      collapsed: settings.collapsed,
      edge: settings.edge,
      busy, needsLogin, loginPending,
      status: viewStatus instanceof CodexError ? t(viewStatus.key, viewStatus.status) : t(viewStatus),
      note: t(viewNote),
    }))
  }

  function placeWindow() {
    if (drag) return
    dockDisplay = displays().find(({ id }) => id === dockDisplay.id) ?? displays().find(display => display.primary)
    host.setBounds(JSON.stringify(dockBounds(dockDisplay.workArea, settings.edge, settings.anchor, settings.collapsed)))
  }

  function setDock(changes) {
    updateSettings({ ...changes, displayId: dockDisplay.id })
    placeWindow()
    publish()
    refreshTray()
  }

  function setCollapsed(collapsed) {
    setDock({ collapsed })
    host.show()
  }

  function setLanguage(language) {
    if (!languages.includes(language) || settings.language === language) return
    updateSettings({ language })
    refreshTray()
    publish()
  }

  function refreshTray() {
    const items = [
      { label: t(settings.collapsed ? 'expand' : 'collapse'), click: () => setCollapsed(!settings.collapsed) },
      {
        label: t('dockEdge'),
        submenu: edges.map((edge) => ({
          label: t(edge), type: 'radio', checked: settings.edge === edge,
          click: () => setDock({ edge }),
        })),
      },
      {
        label: t('language'),
        submenu: languages.map((language) => ({
          label: language === 'en-US' ? 'English' : '简体中文', type: 'radio',
          checked: settings.language === language, click: () => setLanguage(language),
        })),
      },
      { label: t('refreshTray'), click: () => refresh('refresh') },
      {
        label: t('autostart'), type: 'checkbox', checked: host.autostartEnabled(),
        click: ({ checked }) => host.setAutostart(checked),
      },
      { type: 'separator' },
      { label: t('quit'), click: () => host.quit() },
    ]
    setupTray(items)
  }

  function moveDrag() {
    if (!drag) return
    const point = JSON.parse(host.cursor())
    const dx = point.x - drag.start.x
    const dy = point.y - drag.start.y
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    drag.moved = true
    host.setPosition(drag.bounds.x + dx, drag.bounds.y + dy)
  }

  function endDrag(toggleOnClick) {
    if (!drag) return
    moveDrag()
    clearInterval(drag.timer)
    const { moved, fromStrip } = drag
    drag = null
    if (!moved) {
      if (fromStrip && toggleOnClick) setCollapsed(false)
      return
    }
    const point = JSON.parse(host.cursor())
    dockDisplay = nearestDisplay(point)
    setDock(nearestDock(dockDisplay.workArea, point, JSON.parse(host.bounds())))
  }

  events.on('blur', () => endDrag(false))
  events.on('activate', () => setCollapsed(false))
  events.on('display', placeWindow)

  function armAutomaticTimer() {
    clearTimeout(autoTimer)
    if (nextSend === null) return
    const wait = Math.min(Math.max(nextSend - Date.now(), 0), maxTimerDelay)
    autoTimer = setTimeout(checkDeadline, wait)
  }

  function checkDeadline() {
    if (quitting || busy || loginPending) return
    if (nextSend !== null && Date.now() >= nextSend) {
      refresh('automatic')
    } else {
      armAutomaticTimer()
      publish()
    }
  }

  function scheduleNext(includeDue = false) {
    nextSend = !quitting && !loginPending && settings.autoEnabled && quota?.accountId
      ? nextWake(currentSchedule(), quota.windows, Date.now(), includeDue)
      : null
    armAutomaticTimer()
  }

  function applyQuota(response) {
    const previousAccount = quota?.accountId
    needsLogin = response === null
    quota = response ? { ...quotaSnapshot(response), accountId: accountKey(response), email: response.email } : null
    connectedAccount = response?.email ?? null
    accountConnected = Boolean(response)
    if (previousAccount !== quota?.accountId) {
      selectedModel = null
      viewNote = ''
    }
    if (quota?.accountId) {
      const legacy = settings.legacySchedule
      const isLegacyAccount = legacy?.accountId === response.accountId
      const prior = isLegacyAccount && legacy.windows
        ? { ...legacy, accountId: quota.accountId }
        : currentSchedule()
      const schedule = observe(prior, quota, Date.now())
      updateSettings({
        schedules: { ...settings.schedules, [quota.accountId]: schedule },
        legacySchedule: isLegacyAccount ? undefined : legacy,
      })
    }
    viewStatus = needsLogin ? 'signInForTimes'
      : quota?.windows.some(({ resetAt }) => resetAt) ? ''
        : 'noResetTimes'
  }

  async function loadQuota(connection, options) {
    try {
      quotaReadAt = Date.now()
      applyQuota(await connection.readQuota(options))
    } catch (error) {
      quota = null
      selectedModel = null
      connectedAccount = error.connectedAccount ?? null
      accountConnected = error.accountConnected === true
      needsLogin = false
      throw error
    }
  }

  async function refresh(mode) {
    if (busy || quitting || loginPending) return
    if (!codex) {
      viewStatus = 'cliMissing'
      publish()
      return
    }
    clearTimeout(autoTimer)
    nextSend = null
    clearTimeout(settleTimer)
    const manual = mode === 'manual'
    const requestedRefresh = mode === 'refresh'
    const expected = quota?.accountId
    const expectedModel = selectedModel
    busy = true
    publish()

    try {
      await loadQuota(codex, { fresh: true })
      if (!quota?.accountId || needsLogin) return
      if (!selectedModel || mode !== 'automatic' || nextCheck(currentSchedule(), Date.now())?.windows.length) {
        try {
          selectedModel = await codex.greetingModel()
        } catch {
          selectedModel = null
          viewNote = 'modelLookupFailed'
          return
        }
      }
      if (!selectedModel) {
        viewNote = 'lunaUnavailable'
        return
      }
      if (['modelLookupFailed', 'lunaUnavailable'].includes(viewNote)) viewNote = ''
      if (mode === 'read' || mode === 'settle') return
      if (manual && (expected !== quota.accountId || expectedModel?.id !== selectedModel.id
          || expectedModel?.effort !== selectedModel.effort)) {
        viewNote = 'sendSelectionChanged'
        return
      }
      const now = Date.now()
      const pending = nextCheck(currentSchedule(), now)
      const starting = unstartedWindows(currentSchedule(), quota.windows, quotaReadAt)
      if (requestedRefresh && starting.length === 0) return
      if (!manual && !requestedRefresh && (!settings.autoEnabled || !pending?.windows.length || pending.at > now)) return
      if (!quota.canSend) {
        viewNote = 'noIncludedQuota'
        return
      }

      const thread = await codex.prepareGreeting(selectedModel)
      const account = quota.accountId
      const checkedAt = Date.now()
      const final = nextCheck(currentSchedule(), checkedAt)
      if (quitting) return
      if (!manual && !requestedRefresh && (!settings.autoEnabled || !final?.windows.length || final.at > checkedAt)) return
      const elapsedWindows = final?.windows ?? []
      const wasUnscheduled = !quota.windows.some(({ resetAt }) => resetAt)
      updateSettings({
        schedules: {
          ...settings.schedules,
          [account]: recordAttempt(currentSchedule(), elapsedWindows, checkedAt, starting),
        },
        history: addGreeting(settings.history, checkedAt, manual ? 'manual' : requestedRefresh ? 'refresh' : 'automatic'),
      })
      viewNote = 'sending'
      publish()
      const completed = await codex.greet(thread).catch(() => false)
      if (quitting) return
      if (completed) updateSettings({ history: confirmGreeting(settings.history, checkedAt) })
      const resultNote = completed ? 'greetingSent' : 'sendUnconfirmed'
      viewNote = resultNote
      try {
        await loadQuota(codex, { fresh: true })
        if (quota?.accountId === account) viewNote = resultNote
      } finally {
        const waitingForReset = quota?.accountId === account
          && (elapsedWindows.some((minutes) => currentSchedule().windows[minutes]?.attempted)
            || (wasUnscheduled && !quota.windows.some(({ resetAt }) => resetAt)))
        if (completed && !quitting && (!quota || waitingForReset)) {
          settleTimer = setTimeout(() => refresh('settle'), 15_000)
        }
      }
    } catch (error) {
      viewStatus = error instanceof CodexError ? error : 'codexRequestFailed'
    } finally {
      busy = false
      scheduleNext(mode === 'read')
      publish()
    }
  }

  codex?.on('account/login/completed', (event) => {
    if (event.loginId !== codex.loginId) return
    codex.loginId = null
    loginPending = false
    if (!event.success) {
      viewStatus = 'signInIncomplete'
      scheduleNext()
      publish()
      return
    }
    viewNote = ''
    refresh('read')
  })
  codex?.on('disconnected', () => {
    if (!loginPending) return
    loginPending = false
    viewStatus = 'signInDisconnected'
    scheduleNext()
    publish()
  })

  handle('ready', () => {
    placeWindow()
    host.show()
    publish()
  })
  handle('collapse', () => setCollapsed(!settings.collapsed))
  handle('language', setLanguage)
  handle('quit', () => host.quit())
  handle('refresh', () => refresh('refresh'))
  handle('send', () => refresh('manual'))
  handle('drag-start', (fromStrip) => {
    if (drag || typeof fromStrip !== 'boolean') return
    const start = JSON.parse(host.cursor())
    drag = { start, bounds: JSON.parse(host.bounds()), fromStrip, moved: false, timer: setInterval(moveDrag, 16) }
  })
  handle('drag-end', (toggleOnClick) => endDrag(toggleOnClick === true))
  handle('automatic', (value) => {
    if (typeof value !== 'boolean') return
    updateSettings({ autoEnabled: value })
    viewNote = ''
    if (value) refresh('automatic')
    else {
      scheduleNext()
      publish()
    }
  })
  handle('login', async () => {
    if (!codex || busy || loginPending || !needsLogin) return
    loginPending = true
    publish()
    try { await codex.login(host.openLoginURL) }
    catch (error) {
      loginPending = false
      viewStatus = error instanceof CodexError ? error : 'loginOpenFailed'
      scheduleNext()
      publish()
    }
  })
  handle('cancel-login', async () => {
    if (!loginPending) return
    loginPending = false
    await codex?.cancelLogin().catch(() => {})
    scheduleNext()
    publish()
  })
  events.on('resume', checkDeadline)
  events.on('quit', () => {
    quitting = true
    clearTimeout(autoTimer)
    clearTimeout(settleTimer)
    clearInterval(drag?.timer)
    codex?.stop()
    host.remove(scratch)
  })
  refreshTray()
  refresh('automatic')
}

start()
