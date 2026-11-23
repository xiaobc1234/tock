package main

import (
	"io/fs"
	"os"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
)

func TestController(t *testing.T) {
	type result struct{ name, failure string }
	results := make(chan result, 32)
	loop := eventloop.NewEventLoop()
	loop.Start()
	defer loop.Terminate()
	loop.RunOnLoop(func(vm *goja.Runtime) {
		if err := vm.Set("native", map[string]any{}); err != nil {
			results <- result{"setup", err.Error()}
			results <- result{}
			return
		}
		modules := newModules(vm, os.DirFS("."))
		start := func() error {
			api, err := modules.load("test/test-api.cjs")
			if err != nil {
				return err
			}
			modules.loaded["controller/test-api.cjs"] = api
			files, err := fs.Glob(os.DirFS("."), "test/*.test.cjs")
			if err != nil {
				return err
			}
			for _, file := range files {
				if _, err := modules.load(file); err != nil {
					return err
				}
			}
			run, _ := goja.AssertFunction(api.ToObject(vm).Get("run"))
			_, err = run(goja.Undefined(), vm.ToValue(func(name, failure string) {
				results <- result{name, failure}
			}))
			return err
		}
		if err := start(); err != nil {
			results <- result{"setup", err.Error()}
			results <- result{}
		}
	})

	timeout := time.After(10 * time.Second)
	count := 0
	for {
		select {
		case result := <-results:
			if result.name == "" {
				if count == 0 {
					t.Fatal("No JavaScript tests were executed")
				}
				return
			}
			count++
			t.Run(result.name, func(t *testing.T) {
				if result.failure != "" {
					t.Fatal(result.failure)
				}
			})
		case <-timeout:
			t.Fatal("Controller tests timed out")
		}
	}
}

func TestLoginURL(t *testing.T) {
	for _, candidate := range []string{"https://chatgpt.com/auth", "https://auth.openai.com/authorize"} {
		if !validLoginURL(candidate) {
			t.Errorf("Valid sign-in URL rejected: %s", candidate)
		}
	}
	for _, candidate := range []string{"https://auth.openai.com.example.org/authorize", "http://auth.openai.com/", "https://user@auth.openai.com/"} {
		if validLoginURL(candidate) {
			t.Errorf("Unexpected sign-in URL accepted: %s", candidate)
		}
	}
}

func TestLanguagePreference(t *testing.T) {
	start := func(profile string) *goja.Runtime {
		t.Helper()
		vm := goja.New()
		if err := vm.Set("profile", profile); err != nil {
			t.Fatal(err)
		}
		if _, err := vm.RunString(`
		  let snapshot
		  let tray
		  const native = {
		    path: (name) => name,
		    join: (...parts) => parts.join('/'),
		    mkdir() {},
		    exists: () => true,
		    readFile: () => profile,
		    writeFile: (_, value) => { profile = value },
		    rename() {},
		    mkdtemp: (name) => name,
		    findCodex: () => '',
		    cursor: () => '{"x":0,"y":0}',
		    displays: () => '[{"id":"screen","workArea":{"x":0,"y":0,"width":1000,"height":900}}]',
		    autostartEnabled: () => false,
		    menu: (value) => { tray = JSON.parse(value) },
		    snapshot: (value) => { snapshot = JSON.parse(value) }
		  }
		`); err != nil {
			t.Fatal(err)
		}
		if _, err := newModules(vm, assets).load("controller/main.cjs"); err != nil {
			t.Fatal(err)
		}
		return vm
	}
	vm := start(`{"autoEnabled":true,"language":"unsupported"}`)
	profile, err := vm.RunString(`
	  if (snapshot.language !== 'zh-CN' || !snapshot.status.includes('未找到 Codex CLI'))
	    throw new Error('The default language must be Simplified Chinese')
	  dispatchWidget('language', 'en-US')
	  if (snapshot.language !== 'en-US' || !snapshot.status.includes('Codex CLI not found'))
	    throw new Error('The current status did not update with the language')
	  const menu = tray.find(({ label }) => label === 'Language')
	  if (!menu || !menu.submenu[1].checked)
	    throw new Error('The tray did not reflect the selected language')
	  desktopEvent('tray', { index: menu.submenu[0].action })
	  if (snapshot.language !== 'zh-CN')
	    throw new Error('Could not switch language from the tray')
	  dispatchWidget('language', 'en-US')
	  if (!JSON.parse(profile).autoEnabled)
	    throw new Error('Language switching changed automatic sending')
	  profile
	`)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := start(profile.String()).RunString(`snapshot.language === 'en-US' && snapshot.automatic`)
	if err != nil || !restarted.ToBoolean() {
		t.Fatalf("Language preference did not survive restart: %v", err)
	}
}

func TestAutomaticPlanRenderer(t *testing.T) {
	vm := goja.New()
	stub := `
	  const elements = new Map()
	  function element(id) {
	    if (elements.has(id)) return elements.get(id)
	    const node = {
	      dataset: {}, classList: { toggle() {} }, children: [], listeners: {},
	      removeAttribute(name) { this[name] = undefined },
	      setAttribute(name, value) { this[name] = value },
	      addEventListener(event, callback) { this.listeners[event] = callback },
	      querySelector() { return null },
	      append(...nodes) { this.children.push(...nodes) },
	      replaceChildren(...nodes) { this.children = nodes },
	      closest() { return this }
	    }
	    elements.set(id, node)
	    return node
	  }
	  element('#send').dataset.i18n = 'send'
	  element('#refresh').dataset.i18nLabel = 'refreshTimes'
	  let languageRequested
	  const document = {
	    documentElement: {}, querySelector: element, addEventListener() {},
	    querySelectorAll(selector) {
	      const key = { '[data-i18n]': 'i18n', '[data-i18n-label]': 'i18nLabel' }[selector]
	      return [...elements.values()].filter((node) => node.dataset[key])
	    },
	    createElement() { return element(Symbol()) }
	  }
	  const window = { widget: {
	    subscribe(fn) { globalThis.renderSnapshot = fn }, ready() {},
	    language(value) { languageRequested = value }
	  } }
	  const Intl = { DateTimeFormat: function (locale) { this.format = () => locale } }
	`
	if _, err := vm.RunString(stub); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{"frontend/i18n.js", "frontend/widget.js"} {
		source, err := assets.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := vm.RunScript(file, string(source)); err != nil {
			t.Fatal(err)
		}
	}
	result, err := vm.RunString(`
	  const planned = Date.UTC(2026, 10, 23, 5, 30, 13)
	  const snapshot = { automatic: true, nextSend: planned, canSend: false,
	    windows: [], status: '', note: '已发送问候' }
	  renderSnapshot(snapshot)
	  const whileBusy = element('#next').dateTime === new Date(planned).toISOString()
	    && element('#send').disabled
	    && element('#status').textContent === '已发送问候'
	    && element('#send').textContent === '手动发送'
	  element('#language').value = 'en-US'
	  element('#language').listeners.change()
	  element('#history').open = true
	  renderSnapshot({ ...snapshot, language: 'en-US', canSend: true, note: 'Greeting sent',
	    history: [{ at: planned, mode: 'automatic', result: 'sent' }] })
	  whileBusy && !element('#send').disabled
	    && element('#next').dateTime === new Date(planned).toISOString()
	    && document.documentElement.lang === 'en-US'
	    && languageRequested === 'en-US'
	    && element('#send').textContent === 'Send manually'
	    && element('#refresh')['aria-label'] === 'Refresh reset times'
	    && element('#history-items').children[0].children[0].textContent === 'en-US en-US'
	    && element('#history-items').children[0].children[1].textContent === 'Automatic · Sent'
	`)
	if err != nil {
		t.Fatal(err)
	}
	if !result.ToBoolean() {
		t.Fatal("The automatic plan, localized labels, or send history did not render as expected")
	}
}
