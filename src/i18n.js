(() => {
  const defaultLanguage = 'zh-CN'
  const languages = [defaultLanguage, 'en-US']
  const messages = {
    language: ['语言', 'Language'],
    dragWindow: ['拖拽到屏幕边缘', 'Drag to a screen edge'],
    refreshTimes: ['刷新重置时间', 'Refresh reset times'],
    refreshHint: ['刷新重置时间。检测到未开启的周期时发一条问候', 'Refresh reset times and send a greeting if a new cycle has not started'],
    collapse: ['贴边收起', 'Collapse to screen edge'],
    expand: ['展开 Tock', 'Expand Tock'],
    expandHint: ['单击展开，拖拽换边', 'Click to expand, drag to move'],
    quit: ['退出 Tock', 'Quit Tock'],
    resetTimes: ['重置时间', 'Reset times'],
    shortReset: ['5 小时重置', '5-hour reset'],
    weeklyReset: ['每周重置', 'Weekly reset'],
    loading: ['待读取', 'Loading'],
    connecting: ['正在连接 Codex…', 'Connecting to Codex…'],
    signedIn: ['Codex 已登录', 'Signed in to Codex'],
    accountUnknown: ['Codex 账号未确认', 'Codex account unconfirmed'],
    autoSend: ['自动发送问候', 'Send greetings automatically'],
    nextSend: ['下次自动发送', 'Next automatic send'],
    pending: ['待确认', 'Pending'],
    disabled: ['已关闭', 'Off'],
    windowUnreported: ['未报告该窗口', 'Window not reported'],
    send: ['手动发送', 'Send manually'],
    signIn: ['登录 ChatGPT', 'Sign in to ChatGPT'],
    cancelSignIn: ['取消登录', 'Cancel sign-in'],
    finishSignIn: ['请在浏览器完成 Codex 登录', 'Finish signing in to Codex in your browser'],
    findingModel: ['正在识别可用模型…', 'Looking for an available model…'],
    noGreetingModel: ['暂无可用问候模型', 'No greeting model available'],
    history: ['发送记录', 'Send history'],
    close: ['关闭', 'Close'],
    emptyHistory: ['还没有发送记录', 'No greetings sent yet'],
    manual: ['手动发送', 'Manual'],
    automatic: ['自动发送', 'Automatic'],
    refresh: ['刷新时发送', 'Sent on refresh'],
    legacy: ['旧版记录', 'Earlier version'],
    sent: ['已发送', 'Sent'],
    unconfirmed: ['结果未确认', 'Unconfirmed'],
    dockEdge: ['吸附位置', 'Screen edge'],
    left: ['左边', 'Left'],
    right: ['右边', 'Right'],
    top: ['顶部', 'Top'],
    bottom: ['底部', 'Bottom'],
    refreshTray: ['刷新并检查是否开启新周期', 'Refresh and check for a new cycle'],
    autostart: ['登录系统时启动', 'Launch at login'],
    readingTimes: ['正在查询重置时间…', 'Checking reset times…'],
    signInForTimes: ['登录 Codex 后即可显示重置时间', 'Sign in to Codex to see reset times'],
    noResetTimes: ['Codex 暂未提供重置时间', 'Codex has not reported any reset times yet'],
    cliMissing: ['未找到 Codex CLI。请安装后重新打开 Tock。', 'Codex CLI not found. Install it and reopen Tock.'],
    modelLookupFailed: ['暂时无法读取可用模型', 'Could not load available models'],
    lunaUnavailable: ['当前账号没有可用的 Luna 模型', 'Luna is unavailable for this account'],
    sendSelectionChanged: ['账号或模型已更新，请确认后再发送', 'The account or model changed. Review it before sending again.'],
    noIncludedQuota: ['暂未确认有可用的订阅额度，已暂停发送', 'Sending paused because available subscription usage could not be confirmed'],
    sending: ['正在发送问候…', 'Sending greeting…'],
    greetingSent: ['已发送问候', 'Greeting sent'],
    sendUnconfirmed: ['发送结果未确认', 'Greeting delivery unconfirmed'],
    signInIncomplete: ['登录未完成，请重试', 'Sign-in did not complete. Try again.'],
    signInDisconnected: ['登录连接已中断，请重试', 'The sign-in connection was interrupted. Try again.'],
    loginOpenFailed: ['无法打开 ChatGPT 登录', 'Could not open ChatGPT sign-in'],
    accountCheckFailed: ['暂时无法确认 Codex 登录状态', 'Could not confirm your Codex sign-in'],
    codexDisconnected: ['Codex 连接中断', 'Disconnected from Codex'],
    cliStartFailed: ['无法启动 Codex', 'Could not start Codex'],
    codexUnavailable: ['Codex 未连接', 'Codex is not connected'],
    codexRequestFailed: ['Codex 请求失败', 'The Codex request failed'],
    codexTimedOut: ['Codex 连接超时', 'The Codex connection timed out'],
    quotaReadFailed: ['额度查询失败', 'Could not read usage limits'],
    greetingSetupFailed: ['无法准备问候会话', 'Could not start the greeting session'],
    greetingUnconfirmed: ['问候请求未确认', 'The greeting request was not confirmed'],
    quotaAuth: ['Codex 登录已失效，请在 Codex 中重新登录后刷新。', 'Your Codex sign-in expired. Sign in to Codex again, then refresh.'],
    quotaChallenge: ['额度查询遇到服务端访问验证，请稍后刷新。', 'The usage service requested an access check. Try refreshing later.'],
    quotaAccess: ['额度查询被拒绝，请检查当前网络或工作区权限。', 'Access to usage limits was denied. Check your network or workspace permissions.'],
    quotaUnsupported: ['当前 Codex 额度服务不可用，请稍后刷新。', 'The Codex usage service is unavailable. Try refreshing later.'],
    quotaCertificate: ['额度查询未能验证网络证书，请检查网络设置。', 'Could not verify the usage service certificate. Check your network settings.'],
    quotaTimeout: ['额度查询超时，请检查网络后刷新。', 'The usage check timed out. Check your connection and refresh.'],
    quotaService: ['Codex 额度服务暂时无法响应，请稍后刷新。', 'The Codex usage service is not responding. Try refreshing later.'],
    quotaNetwork: ['连接 Codex 额度服务失败，请检查网络后刷新。', 'Could not reach the Codex usage service. Check your connection and refresh.'],
    quotaUnknown: ['Codex 已登录，但额度服务未返回数据，请稍后刷新。', 'You are signed in to Codex, but the usage service returned no data. Try refreshing later.'],
    'effort.default': ['默认推理', 'Default reasoning'],
    'effort.none': ['无推理', 'No reasoning'],
    'effort.minimal': ['极低推理', 'Minimal reasoning'],
    'effort.low': ['低推理', 'Low reasoning'],
    'effort.medium': ['中等推理', 'Medium reasoning'],
    'effort.high': ['高推理', 'High reasoning'],
    'effort.xhigh': ['超高推理', 'Extra-high reasoning'],
    'effort.max': ['最高推理', 'Maximum reasoning'],
    'effort.ultra': ['超高推理', 'Ultra reasoning'],
  }

  function normalizeLanguage(value) {
    return languages.includes(value) ? value : defaultLanguage
  }

  function translate(language, key, status) {
    if (!Object.hasOwn(messages, key)) return ''
    const english = language === 'en-US'
    const text = messages[key][english ? 1 : 0]
    if (!status) return text
    return text + (english ? ` (HTTP ${status})` : `（HTTP ${status}）`)
  }

  const i18n = { defaultLanguage, languages, normalizeLanguage, translate }
  if (typeof module === 'object') module.exports = i18n
  else globalThis.tockI18n = i18n
})()
