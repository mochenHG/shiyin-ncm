package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// Existing output and appearance preferences remain usable after the Go migration.
func TestSettingsCompatibility(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("SHIYIN_DATA_DIR", dir)
	previous := settings{OutputDir: filepath.Join(dir, "music"), Theme: "dark"}
	encoded, _ := json.Marshal(previous)
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), encoded, 0600); err != nil {
		t.Fatal(err)
	}
	app, err := newApp()
	if err != nil {
		t.Fatal(err)
	}
	if app.settings != previous {
		t.Fatalf("settings changed: %+v", app.settings)
	}
	app.mu.Lock()
	app.settings.Theme = "system"
	err = app.saveLocked()
	app.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := newApp()
	if err != nil {
		t.Fatal(err)
	}
	if reopened.settings.OutputDir != previous.OutputDir || reopened.settings.Theme != "system" {
		t.Fatal("output folder was lost when saving appearance")
	}
}
