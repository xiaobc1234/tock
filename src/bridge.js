if (!window.widget) {
  const ready = import('/wails/runtime.js')
  const invoke = (action, value = null) => ready.then(({ Call }) => Call.ByName('main.Widget.Request', action, value))
  window.widget = {
    subscribe: (callback) => { window.tockSnapshot = callback },
    ready: () => invoke('ready'),
    collapse: () => invoke('collapse'),
    quit: () => invoke('quit'),
    refresh: () => invoke('refresh'),
    automatic: (value) => invoke('automatic', value),
    send: () => invoke('send'),
    login: () => invoke('login'),
    cancelLogin: () => invoke('cancel-login'),
    dragStart: (value) => invoke('drag-start', value),
    dragEnd: (value) => invoke('drag-end', value),
  }
}
