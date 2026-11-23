const panel = document.querySelector('#panel')
const tab = document.querySelector('#tab')
const next = document.querySelector('#next')
const status = document.querySelector('#status')
const automatic = document.querySelector('#automatic')
const refresh = document.querySelector('#refresh')
const send = document.querySelector('#send')
const login = document.querySelector('#login')
const account = document.querySelector('#account')
const accountDot = document.querySelector('#account-dot')
const model = document.querySelector('#model')
const historyDialog = document.querySelector('#history')
const historyItems = document.querySelector('#history-items')
const historyEmpty = document.querySelector('#history-empty')
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' })
const historyDate = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })
const clockFormat = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
const efforts = {
  none: '无推理', minimal: '极低推理', low: '低推理', medium: '中等推理',
  high: '高推理', xhigh: '超高推理', max: '最高推理', ultra: '超高推理',
}
let latest

function displayTime(element, value, fallback) {
  const date = value ? new Date(value) : null
  if (date) element.dateTime = date.toISOString()
  else element.removeAttribute('datetime')
  const clock = date ? clockFormat.format(date) : '—'
  const strong = element.querySelector('strong')
  if (strong) {
    strong.textContent = clock
    element.querySelector('span').textContent = date ? dateFormat.format(date) : fallback
  } else {
    element.textContent = date ? dateFormat.format(date) + ' ' + clock : fallback
  }
}

function render(snapshot) {
  latest = snapshot
  if (snapshot.collapsed && historyDialog.open) historyDialog.close()
  panel.hidden = snapshot.collapsed
  tab.hidden = !snapshot.collapsed
  tab.dataset.edge = snapshot.edge
  tab.dataset.active = String(snapshot.automatic)
  automatic.checked = snapshot.automatic
  automatic.disabled = !snapshot.accountKnown && !snapshot.automatic
  refresh.disabled = snapshot.busy || snapshot.loginPending
  send.disabled = !snapshot.canSend
  send.hidden = snapshot.needsLogin
  login.hidden = !snapshot.needsLogin
  login.textContent = snapshot.loginPending ? '取消登录' : '登录 ChatGPT'
  document.querySelector('#windows').classList.toggle('weekly-only', Boolean(snapshot.weeklyOnly))
  document.querySelector('#reset-short').closest('.time-card').hidden = Boolean(snapshot.weeklyOnly)
  account.textContent = snapshot.account || (snapshot.accountConnected ? 'Codex 已登录' : 'Codex 账号未确认')
  account.title = snapshot.account ?? ''
  accountDot.dataset.connected = String(snapshot.accountConnected)
  model.hidden = snapshot.needsLogin
  model.textContent = snapshot.model
    ? snapshot.model.name + ' · ' + (efforts[snapshot.model.effort] ?? snapshot.model.effort ?? '默认推理')
    : snapshot.busy ? '正在识别可用模型…' : '暂无可用问候模型'
  status.textContent = snapshot.loginPending ? '请在浏览器完成 Codex 登录'
    : snapshot.status || snapshot.note
  displayTime(next, snapshot.nextSend, snapshot.automatic ? '待确认' : '已关闭')

  for (const [minutes, selector] of [[300, '#reset-short'], [10080, '#reset-week']]) {
    const item = snapshot.windows.find((entry) => entry.minutes === minutes)
    const fallback = snapshot.hasQuota && snapshot.windows.length > 0 && !item ? '未报告该窗口' : '待确认'
    displayTime(document.querySelector(selector), item?.resetAt, fallback)
  }
  if (historyDialog.open) renderHistory(snapshot.history)
}

function renderHistory(records = []) {
  const types = { manual: '手动发送', automatic: '自动发送', refresh: '刷新时发送', legacy: '旧版记录' }
  historyEmpty.hidden = records.length > 0
  historyItems.replaceChildren(...records.map(({ at, mode, result }) => {
    const row = document.createElement('li')
    const time = document.createElement('time')
    time.dateTime = new Date(at).toISOString()
    time.textContent = historyDate.format(at) + ' ' + clockFormat.format(at)
    const outcome = document.createElement('span')
    outcome.textContent = (types[mode] ?? types.legacy) + ' · ' + (result === 'sent' ? '已发送' : '结果未确认')
    row.append(time, outcome)
    return row
  }))
}

function draggable(element, fromStrip) {
  let pointerId
  element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary || pointerId !== undefined) return
    pointerId = event.pointerId
    element.setPointerCapture(pointerId)
    window.widget.dragStart(fromStrip)
  })
  const end = (event) => {
    if (event.pointerId !== pointerId) return
    pointerId = undefined
    window.widget.dragEnd(event.type === 'pointerup')
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(event, end)
}

draggable(document.querySelector('#drag-handle'), false)
draggable(tab, true)
window.widget.subscribe(render)
window.widget.ready()
tab.addEventListener('click', (event) => { if (event.detail === 0) window.widget.collapse() })
document.querySelector('#collapse').addEventListener('click', () => window.widget.collapse())
document.querySelector('#quit').addEventListener('click', () => window.widget.quit())
refresh.addEventListener('click', () => window.widget.refresh())
automatic.addEventListener('change', () => window.widget.automatic(automatic.checked))
send.addEventListener('click', () => window.widget.send())
login.addEventListener('click', () => latest?.loginPending ? window.widget.cancelLogin() : window.widget.login())
document.querySelector('#show-history').addEventListener('click', () => {
  renderHistory(latest?.history)
  historyDialog.showModal()
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !panel.hidden && !historyDialog.open) window.widget.collapse()
})
