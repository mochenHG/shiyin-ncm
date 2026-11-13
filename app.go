package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/mochenHG/shiyin-ncm/internal/ncm"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sys/windows"
)

type settings struct {
	OutputDir string `json:"outputDir"`
	Theme     string `json:"theme"`
}
type Item struct {
	ID       string      `json:"id"`
	Source   string      `json:"source"`
	Name     string      `json:"name"`
	Size     int64       `json:"size"`
	Status   string      `json:"status"`
	Progress int         `json:"progress"`
	Error    string      `json:"error,omitempty"`
	Result   *ncm.Result `json:"result,omitempty"`
}
type Snapshot struct {
	Type      string `json:"type"`
	Items     []Item `json:"items"`
	OutputDir string `json:"outputDir"`
	Theme     string `json:"theme"`
	Running   bool   `json:"running"`
}
type Action struct {
	Added   int    `json:"added,omitempty"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}
type App struct {
	mu               sync.Mutex
	ctx              context.Context
	dataDir          string
	settings         settings
	items            []Item
	running, closing bool
	cancel           context.CancelFunc
	wg               sync.WaitGroup
}

func newApp() (*App, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}
	dir = filepath.Join(dir, "拾音 NCM")
	if override := os.Getenv("SHIYIN_DATA_DIR"); override != "" && filepath.IsAbs(override) {
		dir = override
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	a := &App{dataDir: dir, items: []Item{}}
	if content, err := os.ReadFile(filepath.Join(dir, "settings.json")); err == nil {
		_ = json.Unmarshal(content, &a.settings)
	}
	if !filepath.IsAbs(a.settings.OutputDir) {
		music, err := windows.KnownFolderPath(windows.FOLDERID_Music, 0)
		if err != nil {
			home, _ := os.UserHomeDir()
			music = filepath.Join(home, "Music")
		}
		a.settings.OutputDir = filepath.Join(music, "拾音转换")
	}
	if a.settings.Theme != "dark" && a.settings.Theme != "light" {
		a.settings.Theme = "system"
	}
	return a, nil
}
func (a *App) startup(ctx context.Context) { a.ctx = ctx }
func (a *App) domReady(ctx context.Context) {
	if len(os.Args) > 1 {
		a.AddFiles(os.Args[1:])
	}
}
func (a *App) Ready() { a.applyTheme(); runtime.WindowShow(a.ctx) }
func (a *App) State() Snapshot {
	a.mu.Lock()
	defer a.mu.Unlock()
	items := append([]Item{}, a.items...)
	return Snapshot{Type: "state", Items: items, OutputDir: a.settings.OutputDir, Theme: a.settings.Theme, Running: a.running}
}
func (a *App) emit() {
	snapshot := a.State()
	a.mu.Lock()
	closing := a.closing
	a.mu.Unlock()
	if !closing {
		runtime.EventsEmit(a.ctx, "update", snapshot)
	}
}
func (a *App) saveLocked() error {
	data, err := json.Marshal(a.settings)
	if err != nil {
		return err
	}
	temp := filepath.Join(a.dataDir, "settings.json.tmp")
	if err := os.WriteFile(temp, data, 0600); err != nil {
		return err
	}
	return os.Rename(temp, filepath.Join(a.dataDir, "settings.json"))
}
func (a *App) applyTheme() {
	a.mu.Lock()
	theme := a.settings.Theme
	a.mu.Unlock()
	switch theme {
	case "dark":
		runtime.WindowSetDarkTheme(a.ctx)
	case "light":
		runtime.WindowSetLightTheme(a.ctx)
	default:
		runtime.WindowSetSystemDefaultTheme(a.ctx)
	}
}
func (a *App) SetTheme(theme string) Action {
	if theme != "system" && theme != "light" && theme != "dark" {
		return Action{}
	}
	a.mu.Lock()
	a.settings.Theme = theme
	err := a.saveLocked()
	a.mu.Unlock()
	if err != nil {
		return Action{Error: err.Error()}
	}
	a.applyTheme()
	a.emit()
	return Action{}
}
func (a *App) AddFiles(paths []string) Action {
	a.mu.Lock()
	busy := a.running
	a.mu.Unlock()
	if busy {
		return Action{Message: "请等当前转换完成后再添加"}
	}
	var sources []string
	ignored := 0
	for _, path := range paths {
		if !filepath.IsAbs(path) {
			continue
		}
		info, err := os.Lstat(path)
		if err != nil {
			ignored++
			continue
		}
		if info.IsDir() {
			_ = filepath.WalkDir(path, func(target string, entry fs.DirEntry, err error) error {
				if err != nil {
					ignored++
					return nil
				}
				if entry.Type()&os.ModeSymlink != 0 {
					return nil
				}
				if !entry.IsDir() && strings.EqualFold(filepath.Ext(target), ".ncm") {
					sources = append(sources, target)
				}
				return nil
			})
		} else if strings.EqualFold(filepath.Ext(path), ".ncm") {
			sources = append(sources, path)
		} else {
			ignored++
		}
	}
	a.mu.Lock()
	if a.running {
		a.mu.Unlock()
		return Action{Message: "请等当前转换完成后再添加"}
	}
	seen := map[string]bool{}
	for _, item := range a.items {
		seen[strings.ToLower(item.Source)] = true
	}
	added := 0
	for _, source := range sources {
		source = filepath.Clean(source)
		key := strings.ToLower(source)
		if seen[key] {
			continue
		}
		info, err := os.Stat(source)
		if err != nil || !info.Mode().IsRegular() {
			ignored++
			continue
		}
		var id [16]byte
		if _, err := rand.Read(id[:]); err != nil {
			ignored++
			continue
		}
		a.items = append(a.items, Item{ID: hex.EncodeToString(id[:]), Source: source, Name: filepath.Base(source), Size: info.Size(), Status: "pending"})
		seen[key] = true
		added++
	}
	a.mu.Unlock()
	a.emit()
	message := "没有新的 NCM 文件可添加"
	if added > 0 {
		message = fmt.Sprintf("已添加 %d 个文件", added)
	}
	if ignored > 0 {
		message += fmt.Sprintf("，忽略 %d 个非 NCM 或不可读文件", ignored)
	}
	return Action{Added: added, Message: message}
}
func (a *App) PickFiles() Action {
	a.mu.Lock()
	busy := a.running
	a.mu.Unlock()
	if busy {
		return Action{}
	}
	files, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{Title: "选择 NCM 音乐", Filters: []runtime.FileFilter{{DisplayName: "网易云音乐 NCM", Pattern: "*.ncm"}}})
	if err != nil {
		return Action{Error: err.Error()}
	}
	if len(files) == 0 {
		return Action{}
	}
	return a.AddFiles(files)
}
func (a *App) PickInputFolder() Action {
	a.mu.Lock()
	busy := a.running
	a.mu.Unlock()
	if busy {
		return Action{}
	}
	folder, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "导入含 NCM 音乐的文件夹"})
	if err != nil {
		return Action{Error: err.Error()}
	}
	if folder == "" {
		return Action{}
	}
	return a.AddFiles([]string{folder})
}
func (a *App) PickOutputFolder() Action {
	a.mu.Lock()
	busy, dir := a.running, a.settings.OutputDir
	a.mu.Unlock()
	if busy {
		return Action{}
	}
	if _, err := os.Stat(dir); err != nil {
		dir = ""
	}
	folder, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "设置 MP3 输出文件夹", DefaultDirectory: dir, CanCreateDirectories: true})
	if err != nil {
		return Action{Error: err.Error()}
	}
	if folder == "" {
		return Action{}
	}
	a.mu.Lock()
	if a.running {
		a.mu.Unlock()
		return Action{}
	}
	a.settings.OutputDir = folder
	err = a.saveLocked()
	a.mu.Unlock()
	if err != nil {
		return Action{Error: err.Error()}
	}
	a.emit()
	return Action{}
}
func (a *App) Remove(id string) {
	a.mu.Lock()
	if !a.running {
		for i, item := range a.items {
			if item.ID == id {
				a.items = append(a.items[:i], a.items[i+1:]...)
				break
			}
		}
	}
	a.mu.Unlock()
	a.emit()
}
func (a *App) Clear() {
	a.mu.Lock()
	if !a.running {
		a.items = []Item{}
	}
	a.mu.Unlock()
	a.emit()
}
func (a *App) update(id string, change func(*Item)) {
	a.mu.Lock()
	var item Item
	found := false
	for i := range a.items {
		if a.items[i].ID == id {
			change(&a.items[i])
			item = a.items[i]
			found = true
			break
		}
	}
	closing := a.closing
	a.mu.Unlock()
	if found && !closing {
		runtime.EventsEmit(a.ctx, "update", map[string]any{"type": "item", "item": item})
	}
}
func (a *App) Start() {
	a.mu.Lock()
	if a.running {
		a.mu.Unlock()
		return
	}
	var pending []Item
	for i := range a.items {
		item := &a.items[i]
		if item.Status == "pending" || item.Status == "error" {
			item.Status = "pending"
			item.Error = ""
			item.Progress = 0
			pending = append(pending, *item)
		}
	}
	if len(pending) == 0 {
		a.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(a.ctx)
	a.running = true
	a.cancel = cancel
	output := a.settings.OutputDir
	a.wg.Add(1)
	a.mu.Unlock()
	a.emit()
	go func() {
		defer a.wg.Done()
		defer cancel()
		defer func() { a.mu.Lock(); a.running = false; a.cancel = nil; a.mu.Unlock(); a.emit() }()
		for _, item := range pending {
			if ctx.Err() != nil {
				break
			}
			a.update(item.ID, func(value *Item) { value.Status = "working" })
			lastProgress := -1
			lastTime := time.Time{}
			result, err := ncm.Convert(ctx, item.Source, output, func(progress int) {
				if progress == lastProgress || progress < 100 && time.Since(lastTime) < 50*time.Millisecond {
					return
				}
				lastProgress = progress
				lastTime = time.Now()
				a.update(item.ID, func(value *Item) { value.Progress = progress })
			})
			a.update(item.ID, func(value *Item) {
				if err == nil {
					value.Status = "done"
					value.Progress = 100
					value.Result = result
				} else if ctx.Err() != nil {
					value.Status = "pending"
					value.Progress = 0
				} else if err != nil {
					value.Status = "error"
					value.Error = err.Error()
				}
			})
		}
	}()
}
func (a *App) Cancel() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cancel != nil {
		a.cancel()
	}
}
func (a *App) OpenOutput() Action {
	a.mu.Lock()
	dir := a.settings.OutputDir
	a.mu.Unlock()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return Action{Error: err.Error()}
	}
	cmd := exec.Command("explorer.exe", dir)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := cmd.Start(); err != nil {
		return Action{Error: err.Error()}
	}
	return Action{}
}
func (a *App) Window(action string) {
	switch action {
	case "minimize":
		runtime.WindowMinimise(a.ctx)
	case "maximize":
		runtime.WindowToggleMaximise(a.ctx)
	case "close":
		runtime.Quit(a.ctx)
	}
}
func (a *App) beforeClose(ctx context.Context) bool {
	a.mu.Lock()
	busy := a.running
	a.mu.Unlock()
	if !busy {
		return false
	}
	answer, err := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{Type: runtime.QuestionDialog, Title: "转换还在进行", Message: "停止转换并退出？", Buttons: []string{"继续转换", "停止并退出"}, DefaultButton: "继续转换", CancelButton: "继续转换"})
	if err != nil || answer != "停止并退出" {
		return true
	}
	a.Cancel()
	return false
}
func (a *App) shutdown(ctx context.Context) {
	a.mu.Lock()
	a.closing = true
	if a.cancel != nil {
		a.cancel()
	}
	a.mu.Unlock()
	a.wg.Wait()
}
func (a *App) secondInstance(data options.SecondInstanceData) {
	if a.ctx != nil {
		runtime.WindowUnminimise(a.ctx)
		runtime.WindowShow(a.ctx)
		a.AddFiles(data.Args)
	}
}
