package main

import (
	"crypto/sha256"
	"embed"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"golang.org/x/sys/windows/registry"
)

//go:embed all:src/ui
var frontend embed.FS

func main() {
	app, err := newApp()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return
	}
	theme := windows.SystemDefault
	if app.settings.Theme == "dark" {
		theme = windows.Dark
	}
	if app.settings.Theme == "light" {
		theme = windows.Light
	}
	dark := theme == windows.Dark
	if theme == windows.SystemDefault {
		if key, err := registry.OpenKey(registry.CURRENT_USER, `Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, registry.QUERY_VALUE); err == nil {
			value, _, err := key.GetIntegerValue("AppsUseLightTheme")
			dark = err == nil && value == 0
			key.Close()
		}
	}
	background := options.NewRGB(250, 250, 251)
	if dark {
		background = options.NewRGB(23, 23, 28)
	}
	instanceID := sha256.Sum256([]byte(app.dataDir))
	err = wails.Run(&options.App{
		Title: "拾音 NCM · NCM 转 MP3", Width: 1040, Height: 780, MinWidth: 800, MinHeight: 620,
		Frameless: true, BackgroundColour: background,
		AssetServer: &assetserver.Options{Assets: frontend},
		OnStartup:   app.startup, OnDomReady: app.domReady, OnBeforeClose: app.beforeClose, OnShutdown: app.shutdown,
		Bind:               []interface{}{app},
		DragAndDrop:        &options.DragAndDrop{EnableFileDrop: true},
		Windows:            &windows.Options{Theme: theme, WebviewUserDataPath: filepath.Join(app.dataDir, "WebView2"), DisablePinchZoom: true},
		SingleInstanceLock: &options.SingleInstanceLock{UniqueId: fmt.Sprintf("cn.mochen.shiyin.ncm.%x", instanceID[:8]), OnSecondInstanceLaunch: app.secondInstance},
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
	}
}
