const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, powerMonitor, screen, shell } = require('electron')
const { createHash } = require('node:crypto')
const { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { Codex } = require('./codex.cjs')
const { quotaSnapshot, observe, nextCheck, nextWake, recordAttempt } = require('./schedule.cjs')
const { attemptHistory, nextAllowedSend } = require('./send-limit.cjs')
const { restoreHistory, addGreeting, confirmGreeting } = require('./history.cjs')
const { edges, expandedSize, dockBounds, nearestDock } = require('./dock.cjs')
const { locateCodex } = require('./paths.cjs')

const appName = 'Tock'
const maxTimerDelay = 2_147_483_647
const edgeLabels = { left: '左边', right: '右边', top: '顶部', bottom: '底部' }

app.setName(appName)
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(start).catch((error) => {
    console.error(error.message)
    app.exit(1)
  })
}

function readSettings(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) ?? {}
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('无法读取 Tock 设置')
    return {}
  }
}

function accountKey(response) {
  if (!response?.accountId) return null
  return createHash('sha256').update(JSON.stringify([response.accountId, response.email ?? null])).digest('hex')
}

function start() {
  if (process.platform === 'darwin') app.dock.hide()
  const dataDir = app.getPath('userData')
  mkdirSync(dataDir, { recursive: true })
  const settingsPath = join(dataDir, 'settings.json')
  const legacyPath = join(app.getPath('appData'), 'Codex 周期', 'settings.json')
  const saved = readSettings(existsSync(settingsPath) ? settingsPath : legacyPath)
  const attempts = attemptHistory(saved.attempts ?? [saved.schedule?.lastAttempt], Date.now())
  let settings = {
    edge: edges.includes(saved.edge) ? saved.edge : 'right',
    collapsed: saved.collapsed === true,
    anchor: Number.isFinite(saved.anchor) ? Math.min(Math.max(saved.anchor, 0), 1) : 0.42,
    displayId: saved.displayId,
    autoEnabled: saved.autoEnabled === true || (saved.autoEnabled === undefined && Boolean(saved.autoAccount)),
    schedules: saved.schedules ?? {},
    legacySchedule: saved.legacySchedule ?? saved.schedule,
    attempts,
    history: restoreHistory(saved.history, [...attempts].reverse()),
  }
  const scratch = mkdtempSync(join(app.getPath('temp'), 'tock-'))
  const binary = locateCodex(app.isPackaged ? process.resourcesPath : undefined)
  const codex = binary ? new Codex(binary, scratch) : null
  let quota = null
  let connectedAccount = null
  let accountConnected = false
  let selectedModel = null
  let viewStatus = '正在查询重置时间…'
  let viewNote = ''
  let needsLogin = false
  let loginPending = false
  let busy = false
  let quitting = false
  let autoTimer
  let cooldownTimer
  let settleTimer
  let nextSend = null
  let drag
  let dockDisplay = screen.getAllDisplays().find(({ id }) => id === settings.displayId)
    ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())

  function updateSettings(changes) {
    const next = { ...settings, ...changes }
    if (JSON.stringify(next) === JSON.stringify(settings) && existsSync(settingsPath)) return
    const temporary = settingsPath + '.tmp'
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 })
    renameSync(temporary, settingsPath)
    settings = next
  }

  const window = new BrowserWindow({
    ...expandedSize, frame: false, transparent: true, alwaysOnTop: true,
    hasShadow: false, show: false, resizable: false, skipTaskbar: true,
    fullscreenable: false, minimizable: false, maximizable: false,
    icon: join(__dirname, 'icon.png'),
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
  const icon = nativeImage.createFromPath(join(__dirname, 'trayTemplate.png'))
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  const tray = new Tray(icon)
  tray.setToolTip(appName)

  function currentSchedule() {
    return settings.schedules[quota?.accountId] ?? { accountId: quota?.accountId, windows: {} }
  }

  function publish() {
    if (window.isDestroyed()) return
    const now = Date.now()
    const allowedAt = nextAllowedSend(settings.attempts, now)
    window.webContents.send('widget:snapshot', {
      windows: quota?.windows.map(({ minutes, resetAt }) => ({ minutes, resetAt })) ?? [],
      hasQuota: Boolean(quota),
      account: connectedAccount,
      accountConnected,
      accountKnown: Boolean(quota?.accountId),
      nextSend,
      history: settings.history,
      automatic: settings.autoEnabled,
      canSend: Boolean(quota?.canSend && quota?.accountId && selectedModel && !busy && allowedAt <= now),
      blockedUntil: allowedAt > now ? allowedAt : null,
      model: selectedModel ? { name: selectedModel.name, effort: selectedModel.effort } : null,
      collapsed: settings.collapsed,
      edge: settings.edge,
      busy, needsLogin, loginPending,
      status: viewStatus,
      note: viewNote,
    })
  }

  function placeWindow() {
    if (drag) return
    dockDisplay = screen.getAllDisplays().find(({ id }) => id === dockDisplay.id) ?? screen.getPrimaryDisplay()
    window.setBounds(dockBounds(dockDisplay.workArea, settings.edge, settings.anchor, settings.collapsed))
  }

  function setDock(changes) {
    updateSettings({ ...changes, displayId: dockDisplay.id })
    placeWindow()
    publish()
    refreshTray()
  }

  function setCollapsed(collapsed) {
    setDock({ collapsed })
    if (collapsed) window.showInactive()
    else window.show()
  }

  function refreshTray() {
    const items = [
      { label: settings.collapsed ? '展开浮窗' : '收起浮窗', click: () => setCollapsed(!settings.collapsed) },
      {
        label: '吸附位置',
        submenu: edges.map((edge) => ({
          label: edgeLabels[edge], type: 'radio', checked: settings.edge === edge,
          click: () => setDock({ edge }),
        })),
      },
      { label: '刷新重置时间', click: () => refresh('read') },
    ]
    if (['darwin', 'win32'].includes(process.platform) && app.isPackaged) {
      items.push({
        label: '登录系统时启动', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
        click: ({ checked }) => app.setLoginItemSettings({ openAtLogin: checked }),
      })
    }
    items.push({ type: 'separator' }, { label: '退出 Tock', click: () => app.quit() })
    tray.setContextMenu(Menu.buildFromTemplate(items))
  }

  function moveDrag() {
    if (!drag) return
    const point = screen.getCursorScreenPoint()
    const dx = point.x - drag.start.x
    const dy = point.y - drag.start.y
    if (!drag.moved && Math.hypot(dx, dy) < 4) return
    drag.moved = true
    window.setPosition(drag.bounds.x + dx, drag.bounds.y + dy)
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
    const point = screen.getCursorScreenPoint()
    dockDisplay = screen.getDisplayNearestPoint(point)
    setDock(nearestDock(dockDisplay.workArea, point, window.getBounds()))
  }

  window.on('blur', () => endDrag(false))
  window.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    app.quit()
  })
  app.on('second-instance', () => setCollapsed(false))
  app.on('activate', () => setCollapsed(false))
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(event, placeWindow)
  window.webContents.once('did-finish-load', () => {
    placeWindow()
    window.showInactive()
    publish()
  })
  window.loadFile(join(__dirname, 'index.html'))
  refreshTray()

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
    clearTimeout(cooldownTimer)
    const now = Date.now()
    const allowedAt = nextAllowedSend(settings.attempts, now)
    nextSend = !quitting && !loginPending && settings.autoEnabled && quota?.accountId
      ? nextWake(currentSchedule(), quota.windows, allowedAt, now, includeDue)
      : null
    armAutomaticTimer()
    // Ending a cooldown just enables the button again. It doesn't read quota.
    if (!quitting && allowedAt > now) cooldownTimer = setTimeout(publish, allowedAt - now)
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
    viewStatus = needsLogin ? '登录 Codex 后即可显示重置时间'
      : quota?.windows.some(({ resetAt }) => resetAt) ? ''
        : 'Codex 暂未提供重置时间'
  }

  async function loadQuota(connection, options) {
    try {
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
      viewStatus = '找不到配套 Codex，请重新安装 Tock'
      publish()
      return
    }
    clearTimeout(autoTimer)
    nextSend = null
    clearTimeout(settleTimer)
    const manual = mode === 'manual'
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
          viewNote = '暂时无法读取可用模型'
          return
        }
      }
      if (!selectedModel) {
        viewNote = '当前账号没有可用的 Luna 模型'
        return
      }
      if (['暂时无法读取可用模型', '当前账号没有可用的 Luna 模型'].includes(viewNote)) viewNote = ''
      if (mode === 'read' || mode === 'settle') return
      if (manual && (expected !== quota.accountId || expectedModel?.id !== selectedModel.id
          || expectedModel?.effort !== selectedModel.effort)) {
        viewNote = '账号或模型已更新，请确认后再发送'
        return
      }
      const now = Date.now()
      const pending = nextCheck(currentSchedule(), now)
      if (!manual && (!settings.autoEnabled || !pending?.windows.length || pending.at > now)) return
      if (nextAllowedSend(settings.attempts, now) > now) return
      if (!quota.canSend) {
        viewNote = '暂未确认有可用的订阅额度，已暂停发送'
        return
      }

      const thread = await codex.prepareGreeting(selectedModel)
      const account = quota.accountId
      const checkedAt = Date.now()
      const final = nextCheck(currentSchedule(), checkedAt)
      if (quitting) return
      if (!manual && (!settings.autoEnabled || !final?.windows.length || final.at > checkedAt)) return
      if (nextAllowedSend(settings.attempts, checkedAt) > checkedAt) return
      const elapsedWindows = final?.windows ?? []
      const wasUnscheduled = !quota.windows.some(({ resetAt }) => resetAt)
      updateSettings({
        schedules: {
          ...settings.schedules,
          [account]: recordAttempt(currentSchedule(), elapsedWindows, checkedAt),
        },
        attempts: [...attemptHistory(settings.attempts, checkedAt), checkedAt],
        history: addGreeting(settings.history, checkedAt, manual ? 'manual' : 'automatic'),
      })
      viewNote = '正在发送问候…'
      publish()
      const completed = await codex.greet(thread).catch(() => false)
      if (quitting) return
      if (completed) updateSettings({ history: confirmGreeting(settings.history, checkedAt) })
      const resultNote = completed ? '已发送问候' : '发送结果未确认，已计入频率限制'
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
      viewStatus = error.message
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
      viewStatus = '登录未完成，请重试'
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
    viewStatus = '登录连接已中断，请重试'
    scheduleNext()
    publish()
  })

  function handle(channel, handler) {
    ipcMain.handle('widget:' + channel, (event, value) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return
      return handler(value)
    })
  }

  handle('ready', publish)
  handle('collapse', () => setCollapsed(!settings.collapsed))
  handle('quit', () => app.quit())
  handle('refresh', () => refresh('read'))
  handle('send', () => refresh('manual'))
  handle('drag-start', (fromStrip) => {
    if (drag || typeof fromStrip !== 'boolean') return
    const start = screen.getCursorScreenPoint()
    drag = { start, bounds: window.getBounds(), fromStrip, moved: false, timer: setInterval(moveDrag, 16) }
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
    try { await codex.login((url) => shell.openExternal(url)) }
    catch (error) {
      loginPending = false
      viewStatus = error.message
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
  powerMonitor.on('resume', checkDeadline)
  powerMonitor.on('unlock-screen', checkDeadline)
  app.on('before-quit', () => {
    quitting = true
    clearTimeout(autoTimer)
    clearTimeout(cooldownTimer)
    clearTimeout(settleTimer)
    clearInterval(drag?.timer)
    codex?.stop()
    rmSync(scratch, { recursive: true, force: true })
  })
  refresh('automatic')
}
