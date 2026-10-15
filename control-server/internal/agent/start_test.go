package agent

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestAgentConfigValidationBeforeADB(t *testing.T) {
	for _, config := range []Config{
		{Serial: "bad;serial", BitRate: 10000000},
		{Serial: "emulator-5554", BitRate: 1},
		{Serial: "emulator-5554", BitRate: 10000000},
	} {
		if err := Start(context.Background(), config); err == nil {
			t.Fatal("accepted an invalid agent configuration")
		}
	}
}

func TestAgentArtifactsAndABIs(t *testing.T) {
	directory := t.TempDir()
	if err := requireFile(directory); err == nil {
		t.Fatal("accepted directory as an agent artifact")
	}
	file := filepath.Join(directory, "agent.jar")
	if err := requireFile(file); err == nil {
		t.Fatal("accepted missing artifact")
	}
	if err := os.WriteFile(file, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := requireFile(file); err != nil {
		t.Fatal(err)
	}
	for _, abi := range []string{"arm64-v8a", "armeabi-v7a", "x86", "x86_64"} {
		if !supportedAndroidABI(abi) {
			t.Errorf("rejected supported ABI %s", abi)
		}
	}
	if supportedAndroidABI("unknown") {
		t.Fatal("accepted unknown ABI")
	}
}
