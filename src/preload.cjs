const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('widget', {
  subscribe: (callback) => ipcRenderer.on('widget:snapshot', (_, snapshot) => callback(snapshot)),
  ready: () => ipcRenderer.invoke('widget:ready'),
  collapse: () => ipcRenderer.invoke('widget:collapse'),
  quit: () => ipcRenderer.invoke('widget:quit'),
  refresh: () => ipcRenderer.invoke('widget:refresh'),
  automatic: (enabled) => ipcRenderer.invoke('widget:automatic', enabled),
  send: () => ipcRenderer.invoke('widget:send'),
  login: () => ipcRenderer.invoke('widget:login'),
  cancelLogin: () => ipcRenderer.invoke('widget:cancel-login'),
  dragStart: (fromStrip) => ipcRenderer.invoke('widget:drag-start', fromStrip),
  dragEnd: (toggleOnClick) => ipcRenderer.invoke('widget:drag-end', toggleOnClick),
})
