// Desktop and local process primitives used by the shared Tock controller.
class Emitter {
  constructor() { this.listeners = new Map() }
  on(name, fn) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn])
    return this
  }
  once(name, fn) {
    const wrapped = (...args) => { this.off(name, wrapped); fn(...args) }
    wrapped.original = fn
    return this.on(name, wrapped)
  }
  off(name, fn) {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter(item => item !== fn && item.original !== fn))
    return this
  }
  emit(name, ...args) {
    for (const fn of this.listeners.get(name) ?? []) fn(...args)
  }
}

const handlers = new Map()
const events = new Emitter()
let trayActions = []

function distance(area, point) {
  const x = Math.max(area.x - point.x, 0, point.x - area.x - area.width)
  const y = Math.max(area.y - point.y, 0, point.y - area.y - area.height)
  return x * x + y * y
}

const displays = () => JSON.parse(native.displays())

function nearestDisplay(point) {
  return displays().reduce((best, display) => (
    !best || distance(display.workArea, point) < distance(best.workArea, point) ? display : best
  ), null)
}

function menuItems(input) {
  return input.map(({ label, type, checked, submenu, click }) => {
    const item = { label, type, checked, submenu: submenu && menuItems(submenu) }
    if (click) { item.action = trayActions.length; trayActions.push(click) }
    return item
  })
}

function setupTray(items) {
  trayActions = []
  native.menu(JSON.stringify(menuItems(items)))
}

globalThis.dispatchWidget = (action, value) => handlers.get(action)?.(value)
globalThis.desktopEvent = (type, value) => {
  if (type === 'tray') trayActions[value.index]?.({ checked: value.checked })
  else events.emit(type)
}

module.exports = {
  host: native,
  Emitter,
  events,
  handle: (action, callback) => handlers.set(action, callback),
  displays,
  nearestDisplay,
  setupTray,
}
