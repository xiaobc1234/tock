package main

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"os/exec"
	"syscall"
	"unsafe"
)

var getCursorPos = syscall.NewLazyDLL("user32.dll").NewProc("GetCursorPos")

func hideConsole(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
}

func cursorPosition(app *application.App) map[string]int {
	var raw struct{ X, Y int32 }
	getCursorPos.Call(uintptr(unsafe.Pointer(&raw)))
	x, y := int(raw.X), int(raw.Y)
	for _, s := range app.Screen.GetAll() {
		p := s.PhysicalBounds
		if x >= p.X && x < p.X+p.Width && y >= p.Y && y < p.Y+p.Height && s.ScaleFactor > 0 {
			return map[string]int{"x": s.Bounds.X + int(float32(x-p.X)/s.ScaleFactor), "y": s.Bounds.Y + int(float32(y-p.Y)/s.ScaleFactor)}
		}
	}
	return map[string]int{"x": x, "y": y}
}
