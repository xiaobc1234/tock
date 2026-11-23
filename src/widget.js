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
const languageSelect = document.querySelector('#language')
const { defaultLanguage, normalizeLanguage, translate } = globalThis.tockI18n
let language
let dateFormat
let historyDate
let clockFormat
let latest
const t = (key) => translate(language, key)

function applyLanguage(value) {
  const nextLanguage = normalizeLanguage(value)
  if (nextLanguage === language) return
  language = nextLanguage
  document.documentElement.lang = language
  languageSelect.value = language
  dateFormat = new Intl.DateTimeFormat(language, { month: 'numeric', day: 'numeric' })
  historyDate = new Intl.DateTimeFormat(language, { year: 'numeric', month: 'numeric', day: 'numeric' })
  clockFormat = new Intl.DateTimeFormat(language, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n)
  for (const node of document.querySelectorAll('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle)
  for (const node of document.querySelectorAll('[data-i18n-label]')) node.setAttribute('aria-label', t(node.dataset.i18nLabel))
}

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
  applyLanguage(snapshot.language)
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
  login.textContent = t(snapshot.loginPending ? 'cancelSignIn' : 'signIn')
  document.querySelector('#windows').classList.toggle('weekly-only', Boolean(snapshot.weeklyOnly))
  document.querySelector('#reset-short').closest('.time-card').hidden = Boolean(snapshot.weeklyOnly)
  account.textContent = snapshot.account || t(snapshot.accountConnected ? 'signedIn' : 'accountUnknown')
  account.title = snapshot.account ?? ''
  accountDot.dataset.connected = String(snapshot.accountConnected)
  model.hidden = snapshot.needsLogin
  const effort = snapshot.model?.effort ?? 'default'
  model.textContent = snapshot.model
    ? snapshot.model.name + ' · ' + (t('effort.' + effort) || effort)
    : t(snapshot.busy ? 'findingModel' : 'noGreetingModel')
  status.textContent = snapshot.loginPending ? t('finishSignIn')
    : snapshot.status || snapshot.note
  displayTime(next, snapshot.nextSend, t(snapshot.automatic ? 'pending' : 'disabled'))

  for (const [minutes, selector] of [[300, '#reset-short'], [10080, '#reset-week']]) {
    const item = snapshot.windows.find((entry) => entry.minutes === minutes)
    const fallback = t(snapshot.hasQuota && snapshot.windows.length > 0 && !item ? 'windowUnreported' : 'pending')
    displayTime(document.querySelector(selector), item?.resetAt, fallback)
  }
  if (historyDialog.open) renderHistory(snapshot.history)
}

function renderHistory(records = []) {
  historyEmpty.hidden = records.length > 0
  historyItems.replaceChildren(...records.map(({ at, mode, result }) => {
    const row = document.createElement('li')
    const time = document.createElement('time')
    time.dateTime = new Date(at).toISOString()
    time.textContent = historyDate.format(at) + ' ' + clockFormat.format(at)
    const outcome = document.createElement('span')
    const modeKey = ['manual', 'automatic', 'refresh'].includes(mode) ? mode : 'legacy'
    outcome.textContent = t(modeKey) + ' · ' + t(result === 'sent' ? 'sent' : 'unconfirmed')
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
applyLanguage(defaultLanguage)
window.widget.subscribe(render)
window.widget.ready()
tab.addEventListener('click', (event) => { if (event.detail === 0) window.widget.collapse() })
document.querySelector('#collapse').addEventListener('click', () => window.widget.collapse())
document.querySelector('#quit').addEventListener('click', () => window.widget.quit())
refresh.addEventListener('click', () => window.widget.refresh())
languageSelect.addEventListener('change', () => window.widget.language(languageSelect.value))
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
