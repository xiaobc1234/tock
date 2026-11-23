package main

import (
	"bufio"
	"io"
	"os/exec"

	"github.com/dop251/goja"
)

type childProcess struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser
}

func (w *Widget) spawn(binary string, args []string, cwd string, notify func(string, string)) (int, error) {
	cmd := exec.Command(binary, args...)
	cmd.Dir = cwd
	hideConsole(cmd)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return 0, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return 0, err
	}
	if err = cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		return 0, err
	}
	pid := cmd.Process.Pid
	w.processLock.Lock()
	w.processes[pid] = &childProcess{cmd, stdin}
	w.processLock.Unlock()
	emit := func(kind, value string) { w.loop.RunOnLoop(func(_ *goja.Runtime) { notify(kind, value) }) }
	go func() {
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 4096), 16*1024*1024)
		for scanner.Scan() {
			emit("line", scanner.Text())
		}
		if scanner.Err() != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
		w.processLock.Lock()
		delete(w.processes, pid)
		w.processLock.Unlock()
		emit("exit", "")
	}()
	return pid, nil
}

func (w *Widget) writeChild(pid int, data string) error {
	w.processLock.Lock()
	child := w.processes[pid]
	w.processLock.Unlock()
	if child == nil {
		return io.ErrClosedPipe
	}
	_, err := io.WriteString(child.stdin, data)
	return err
}

func (w *Widget) killChild(pid int) {
	w.processLock.Lock()
	child := w.processes[pid]
	w.processLock.Unlock()
	if child != nil {
		_ = child.cmd.Process.Kill()
	}
}
