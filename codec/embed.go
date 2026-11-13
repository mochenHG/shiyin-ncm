package codec

import (
	"crypto/sha256"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
)

//go:embed libmp3lame.dll
var binary []byte

//go:embed COPYING
var license []byte

// Path keeps the encoder replaceable: a DLL beside the exe takes precedence.
func Path() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	external := filepath.Join(filepath.Dir(exe), "libmp3lame.dll")
	if info, err := os.Stat(external); err == nil && !info.IsDir() {
		return external, nil
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(binary)
	dir := filepath.Join(cache, "ShiyinNCM", "codec", fmt.Sprintf("%x", hash[:8]))
	target := filepath.Join(dir, "libmp3lame.dll")
	if contents, err := os.ReadFile(target); err == nil && sha256.Sum256(contents) == hash {
		return target, nil
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", err
	}
	temp, err := os.CreateTemp(dir, "encoder-*.tmp")
	if err != nil {
		return "", err
	}
	defer os.Remove(temp.Name())
	if _, err := temp.Write(binary); err != nil {
		temp.Close()
		return "", err
	}
	if err := temp.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(temp.Name(), target); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(dir, "COPYING"), license, 0600); err != nil {
		return "", err
	}
	return target, nil
}
