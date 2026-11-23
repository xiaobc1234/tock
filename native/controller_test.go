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

func TestAutomaticPlanRenderer(t *testing.T) {
	vm := goja.New()
	stub := `
	  const elements = new Map()
	  function element(id) {
	    if (elements.has(id)) return elements.get(id)
	    const node = {
	      dataset: {}, classList: { toggle() {} },
	      removeAttribute(name) { this[name] = undefined },
	      addEventListener() {}, querySelector() { return null },
	      closest() { return this }
	    }
	    elements.set(id, node)
	    return node
	  }
	  const document = { querySelector: element, addEventListener() {} }
	  const window = { widget: { subscribe(fn) { globalThis.renderSnapshot = fn }, ready() {} } }
	  const Intl = { DateTimeFormat: function () { this.format = (date) => new Date(date).toISOString() } }
	`
	if _, err := vm.RunString(stub); err != nil {
		t.Fatal(err)
	}
	source, err := assets.ReadFile("frontend/widget.js")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := vm.RunScript("widget.js", string(source)); err != nil {
		t.Fatal(err)
	}
	result, err := vm.RunString(`
	  const planned = Date.UTC(2026, 10, 23, 5, 30, 13)
	  const snapshot = { automatic: true, nextSend: planned, canSend: false,
	    windows: [], status: '', note: '已发送问候' }
	  renderSnapshot(snapshot)
	  const whileBusy = element('#next').dateTime === new Date(planned).toISOString()
	    && element('#send').disabled
	    && element('#status').textContent === '已发送问候'
	  renderSnapshot({ ...snapshot, canSend: true })
	  whileBusy && !element('#send').disabled
	    && element('#next').dateTime === new Date(planned).toISOString()
	`)
	if err != nil {
		t.Fatal(err)
	}
	if !result.ToBoolean() {
		t.Fatal("Manual button availability changed the displayed automatic plan")
	}
}
