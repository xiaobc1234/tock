package main

import (
	"fmt"
	"io/fs"
	"path"
	"strings"

	"github.com/dop251/goja"
)

type modules struct {
	vm     *goja.Runtime
	files  fs.FS
	loaded map[string]goja.Value
}

func newModules(vm *goja.Runtime, files fs.FS) *modules {
	return &modules{vm: vm, files: files, loaded: make(map[string]goja.Value)}
}

func (m *modules) require(name string) goja.Value {
	if !strings.HasPrefix(name, "./") || path.Base(name) != strings.TrimPrefix(name, "./") {
		panic(m.vm.NewGoError(fmt.Errorf("module unavailable: %s", name)))
	}
	value, err := m.load("controller/" + path.Base(name))
	if err != nil {
		panic(m.vm.NewGoError(err))
	}
	return value
}

func (m *modules) load(filename string) (goja.Value, error) {
	if value, ok := m.loaded[filename]; ok {
		return value, nil
	}
	source, err := fs.ReadFile(m.files, filename)
	if err != nil {
		return nil, err
	}
	value, err := m.vm.RunScript(filename, "(function(module, require){\n"+string(source)+"\n})")
	if err != nil {
		return nil, err
	}
	run, ok := goja.AssertFunction(value)
	if !ok {
		return nil, fmt.Errorf("invalid module: %s", filename)
	}
	module := m.vm.NewObject()
	if err := module.Set("exports", m.vm.NewObject()); err != nil {
		return nil, err
	}
	if _, err := run(goja.Undefined(), module, m.vm.ToValue(m.require)); err != nil {
		return nil, err
	}
	exports := module.Get("exports")
	m.loaded[filename] = exports
	return exports, nil
}
