package main

/*
#cgo LDFLAGS: -framework CoreGraphics -framework CoreFoundation
#include <CoreGraphics/CoreGraphics.h>
static CGPoint mousePosition() {
	CGEventRef event = CGEventCreate(NULL);
	if (event == NULL) return CGPointZero;
	CGPoint point = CGEventGetLocation(event);
	CFRelease(event);
	return point;
}
*/
import "C"

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"os/exec"
)

func hideConsole(_ *exec.Cmd) {}

func cursorPosition(_ *application.App) map[string]int {
	p := C.mousePosition()
	return map[string]int{"x": int(p.x), "y": int(p.y)}
}
