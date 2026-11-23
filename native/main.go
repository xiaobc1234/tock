package main

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"io/fs"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed frontend/* controller/*
var assets embed.FS

const bundleID = "local.codex.quota-widget"

var version = "dev"

type Widget struct {
	loop          *eventloop.EventLoop
	app           *application.App
	window        *application.WebviewWindow
	tray          *application.SystemTray
	root, profile string
	initialized   bool
	processLock   sync.Mutex
	processes     map[int]*childProcess
}

func main() {
	profile := flag.String("user-data-dir", "", "Local Tock settings directory")
	flag.Parse()
	root, err := os.UserConfigDir()
	if err != nil {
		log.Fatal(err)
	}
	if *profile == "" {
		*profile = filepath.Join(root, "Tock")
	}
	*profile, err = filepath.Abs(*profile)
	if err != nil {
		log.Fatal(err)
	}
	web, err := fs.Sub(assets, "frontend")
	if err != nil {
		log.Fatal(err)
	}
	w := &Widget{loop: eventloop.NewEventLoop(), root: root, profile: *profile, processes: make(map[int]*childProcess)}
	icon, _ := fs.ReadFile(web, "icon.png")
	w.app = application.New(application.Options{
		Name:     "Tock",
		Icon:     icon,
		Assets:   application.AssetOptions{Handler: application.BundledAssetFileServer(web)},
		Services: []application.Service{application.NewService(w)},
		Mac:      application.MacOptions{ActivationPolicy: application.ActivationPolicyAccessory, ApplicationShouldTerminateAfterLastWindowClosed: true},
		Windows:  application.WindowsOptions{WebviewUserDataPath: filepath.Join(*profile, "WebView2")},
		SingleInstance: &application.SingleInstanceOptions{UniqueID: bundleID + "-" + digest(*profile)[:12],
			OnSecondInstanceLaunch: func(_ application.SecondInstanceData) { w.event("activate", nil) }},
		OnShutdown: w.stop,
	})
	w.tray = w.app.SystemTray.New()
	if runtime.GOOS == "darwin" {
		trayImage, _ := fs.ReadFile(web, "trayTemplate.png")
		w.tray.SetTemplateIcon(trayImage)
	} else {
		w.tray.SetIcon(icon)
	}
	w.tray.SetTooltip("Tock")
	w.window = w.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name: "main", Title: "Tock", URL: "/", Width: 352, Height: 420,
		Frameless: true, DisableResize: true, AlwaysOnTop: true, Hidden: true,
		BackgroundType: application.BackgroundTypeTransparent,
		Mac: application.MacWindow{Backdrop: application.MacBackdropTransparent,
			DisableShadow: true, CornerType: application.MacWindowCornerTypeSquare,
			CollectionBehavior: application.MacWindowCollectionBehaviorCanJoinAllSpaces},
		Windows: application.WindowsWindow{HiddenOnTaskbar: true},
	})
	w.window.OnWindowEvent(events.Common.WindowLostFocus, func(_ *application.WindowEvent) { w.event("blur", nil) })
	w.window.OnWindowEvent(events.Common.WindowFocus, func(_ *application.WindowEvent) { w.event("resume", nil) })
	w.app.Event.OnApplicationEvent(events.Common.SystemDidWake, func(_ *application.ApplicationEvent) { w.event("resume", nil) })
	w.app.Event.OnApplicationEvent(events.Mac.ApplicationDidChangeScreenParameters, func(_ *application.ApplicationEvent) { w.event("display", nil) })
	w.loop.Start()
	if err := w.app.Run(); err != nil {
		log.Fatal(err)
	}
}

// Request is the renderer's single entry point. Only actions registered by the
// shared controller can be dispatched; the renderer has no process or file API.
func (w *Widget) Request(action string, value any) {
	w.loop.RunOnLoop(func(vm *goja.Runtime) {
		if !w.initialized {
			if action != "ready" {
				return
			}
			if err := w.startController(vm); err != nil {
				log.Printf("Tock startup: %v", err)
				go w.app.Quit()
				return
			}
			w.initialized = true
		}
		w.call(vm, "dispatchWidget", action, value)
	})
}

func (w *Widget) call(vm *goja.Runtime, method string, args ...any) {
	if fn, ok := goja.AssertFunction(vm.Get(method)); ok {
		values := make([]goja.Value, len(args))
		for i, arg := range args {
			values[i] = vm.ToValue(arg)
		}
		if _, err := fn(goja.Undefined(), values...); err != nil {
			log.Printf("Tock %s: %v", method, err)
		}
	}
}

func (w *Widget) event(name string, value any) {
	w.loop.RunOnLoop(func(vm *goja.Runtime) { w.call(vm, "desktopEvent", name, value) })
}

func (w *Widget) stop() {
	w.event("quit", nil)
	w.processLock.Lock()
	defer w.processLock.Unlock()
	for _, child := range w.processes {
		_ = child.cmd.Process.Kill()
	}
}

func digest(s string) string {
	d := sha256.Sum256([]byte(s))
	return hex.EncodeToString(d[:])
}

func asJSON(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

type box struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

func (w *Widget) displays() string {
	screens := w.app.Screen.GetAll()
	result := make([]map[string]any, 0, len(screens))
	for _, s := range screens {
		a := s.WorkArea
		result = append(result, map[string]any{"id": s.ID, "primary": s.IsPrimary, "workArea": box{a.X, a.Y, a.Width, a.Height}})
	}
	return asJSON(result)
}

func (w *Widget) startController(vm *goja.Runtime) error {
	host := map[string]any{
		"path": func(name string) string {
			switch name {
			case "userData":
				return w.profile
			case "appData":
				return w.root
			default:
				return os.TempDir()
			}
		},
		"join":      filepath.Join,
		"exists":    func(name string) bool { _, err := os.Stat(name); return err == nil },
		"mkdir":     func(name string) error { return os.MkdirAll(name, 0700) },
		"mkdtemp":   func(name string) (string, error) { return os.MkdirTemp(filepath.Dir(name), filepath.Base(name)) },
		"rename":    os.Rename,
		"remove":    os.RemoveAll,
		"writeFile": func(name, data string) error { return os.WriteFile(name, []byte(data), 0600) },
		"readFile":  func(name string) (string, error) { b, err := os.ReadFile(name); return string(b), err },
		"sha256":    digest,
		"findCodex": findCodex,
		"spawn":     w.spawn,
		"write":     w.writeChild,
		"kill":      w.killChild,
		"show":      func() { w.window.Show() },
		"displays":  w.displays,
		"cursor":    func() string { return asJSON(cursorPosition(w.app)) },
		"bounds":    func() string { a := w.window.Bounds(); return asJSON(box{a.X, a.Y, a.Width, a.Height}) },
		"setBounds": func(raw string) {
			var b box
			if json.Unmarshal([]byte(raw), &b) == nil {
				w.window.SetBounds(application.Rect{X: b.X, Y: b.Y, Width: b.Width, Height: b.Height})
			}
		},
		"setPosition": w.window.SetPosition,
		"snapshot":    func(raw string) { w.window.ExecJS("window.tockSnapshot?.(" + raw + ")") },
		"menu":        w.setMenu,
		"version":     version,
		"openLoginURL": func(raw string) error {
			if !validLoginURL(raw) {
				return errors.New("无法验证登录地址")
			}
			return w.app.Browser.OpenURL(raw)
		},
		"quit":             func() { go w.app.Quit() },
		"autostartEnabled": func() bool { status, _ := w.app.Autostart.Status(); return status.Enabled },
		"setAutostart": func(on bool) error {
			if on {
				return w.app.Autostart.Enable()
			}
			return w.app.Autostart.Disable()
		},
	}
	if err := vm.Set("native", host); err != nil {
		return err
	}
	_, err := newModules(vm, assets).load("controller/main.cjs")
	return err
}

func validLoginURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || (u.Port() != "" && u.Port() != "443") {
		return false
	}
	host := u.Hostname()
	return host == "chatgpt.com" || host == "auth.openai.com"
}

type menuItem struct {
	Label   string     `json:"label"`
	Type    string     `json:"type"`
	Checked bool       `json:"checked"`
	Action  int        `json:"action"`
	Submenu []menuItem `json:"submenu"`
}

func (w *Widget) setMenu(raw string) {
	var items []menuItem
	if json.Unmarshal([]byte(raw), &items) != nil {
		return
	}
	var fill func(*application.Menu, []menuItem)
	fill = func(menu *application.Menu, source []menuItem) {
		for _, item := range source {
			if item.Submenu != nil {
				fill(menu.AddSubmenu(item.Label), item.Submenu)
				continue
			}
			if item.Type == "separator" {
				menu.AddSeparator()
				continue
			}
			var entry *application.MenuItem
			if item.Type == "radio" {
				entry = menu.AddRadio(item.Label, item.Checked)
			} else if item.Type == "checkbox" {
				entry = menu.AddCheckbox(item.Label, item.Checked)
			} else {
				entry = menu.Add(item.Label)
			}
			entry.OnClick(func(_ *application.Context) {
				w.event("tray", map[string]any{"index": item.Action, "checked": !item.Checked})
			})
		}
	}
	menu := application.NewMenu()
	fill(menu, items)
	w.tray.SetMenu(menu)
}

// Resolve native npm payloads directly so a Finder launch does not need the
// user's interactive Node PATH, and Windows never starts a .cmd wrapper.
func findCodex() string {
	home, _ := os.UserHomeDir()
	if runtime.GOOS == "windows" {
		prefix := filepath.Join(os.Getenv("APPDATA"), "npm")
		roots := append([]string{prefix, filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "OpenAI", "Codex", "bin"),
			filepath.Join(home, ".local", "bin")}, filepath.SplitList(os.Getenv("PATH"))...)
		for _, dir := range roots {
			if dir == "" || !filepath.IsAbs(dir) {
				continue
			}
			if found := npmBinary(dir, "win32-x64", "x86_64-pc-windows-msvc", "codex.exe"); found != "" {
				return found
			}
			if p := filepath.Join(dir, "codex.exe"); executable(p) {
				return p
			}
		}
		return ""
	}
	roots := append(filepath.SplitList(os.Getenv("PATH")), filepath.Join(home, ".local", "bin"), filepath.Join(home, "bin"), "/opt/homebrew/bin", "/usr/local/bin")
	for _, dir := range roots {
		if dir == "" || !filepath.IsAbs(dir) {
			continue
		}
		p := filepath.Join(dir, "codex")
		if !executable(p) {
			continue
		}
		resolved, err := filepath.EvalSymlinks(p)
		if err == nil && strings.HasSuffix(filepath.ToSlash(resolved), "/@openai/codex/bin/codex.js") {
			root := filepath.Dir(filepath.Dir(resolved))
			for _, arch := range []string{runtime.GOARCH, "arm64", "amd64"} {
				name, triple := "x64", "x86_64-apple-darwin"
				if arch == "arm64" {
					name, triple = "arm64", "aarch64-apple-darwin"
				}
				for _, modules := range []string{filepath.Join(root, "node_modules", "@openai"), filepath.Dir(root)} {
					candidate := filepath.Join(modules, "codex-darwin-"+name, "vendor", triple, "bin", "codex")
					if executable(candidate) {
						return candidate
					}
				}
			}
			continue
		}
		return p
	}
	for _, base := range []string{"/Applications", filepath.Join(home, "Applications")} {
		p := filepath.Join(base, "ChatGPT.app", "Contents", "Resources", "codex-cli", "bin", "codex")
		if executable(p) {
			return p
		}
	}
	return ""
}

func npmBinary(prefix, target, triple, name string) string {
	modules := filepath.Join(prefix, "node_modules", "@openai")
	for _, base := range []string{modules, filepath.Join(modules, "codex", "node_modules", "@openai")} {
		p := filepath.Join(base, "codex-"+target, "vendor", triple, "bin", name)
		if executable(p) {
			return p
		}
	}
	return ""
}

func executable(p string) bool {
	s, err := os.Stat(p)
	return err == nil && s.Mode().IsRegular() && (runtime.GOOS == "windows" || s.Mode().Perm()&0111 != 0)
}
