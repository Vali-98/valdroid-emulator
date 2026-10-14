package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

type agentConfig struct {
	ADBPath       string
	Serial        string
	DistDir       string
	SocketName    string
	SocketAddress string
	BitRate       int
}

var (
	agentStateMu        sync.RWMutex
	agentStarting       bool
	agentStarted        bool
	agentStartError     string
	deviceSerialPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]+$`)
)

func setAgentState(starting, started bool, err string) {
	agentStateMu.Lock()
	agentStarting = starting
	agentStarted = started
	agentStartError = err
	agentStateMu.Unlock()
}

func installAndStartAgent(parent context.Context, config agentConfig) error {
	if !deviceSerialPattern.MatchString(config.Serial) {
		return errors.New("invalid Android device serial")
	}
	if config.BitRate < 100000 || config.BitRate > 100000000 {
		return errors.New("agent bit rate must be between 100000 and 100000000")
	}
	ctx, cancel := context.WithTimeout(parent, adbStartupTimeout)
	defer cancel()

	runADB := func(args ...string) ([]byte, error) {
		command := exec.CommandContext(ctx, config.ADBPath, append([]string{"-s", config.Serial}, args...)...)
		output, err := command.CombinedOutput()
		if err != nil {
			return nil, fmt.Errorf("adb %s: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
		}
		return output, nil
	}

	abiOutput, err := runADB("shell", "getprop", "ro.product.cpu.abi")
	if err != nil {
		return err
	}
	abi := strings.TrimSpace(string(abiOutput))
	if !supportedAndroidABI(abi) {
		return fmt.Errorf("unsupported Android ABI %q", abi)
	}

	jarPath := filepath.Join(config.DistDir, "screen-sharing-agent.jar")
	libraryPath := filepath.Join(config.DistDir, "agent-libs", abi, "libscreen-sharing-agent.so")
	if err := requireFile(jarPath); err != nil {
		return err
	}
	if err := requireFile(libraryPath); err != nil {
		return err
	}
	if _, err := runADB("shell", "mkdir", "-p", "/data/local/tmp/.studio"); err != nil {
		return err
	}

	if !remoteFileMatches(ctx, config, jarPath, "/data/local/tmp/screen-sharing-agent.jar") {
		if _, err := runADB("push", jarPath, "/data/local/tmp/screen-sharing-agent.jar"); err != nil {
			return err
		}
	}
	if !remoteFileMatches(ctx, config, libraryPath, "/data/local/tmp/.studio/libscreen-sharing-agent.so") {
		if _, err := runADB("push", libraryPath, "/data/local/tmp/.studio/libscreen-sharing-agent.so"); err != nil {
			return err
		}
	}

	_, port, err := net.SplitHostPort(config.SocketAddress)
	if err != nil {
		return fmt.Errorf("invalid agent socket address %q: %w", config.SocketAddress, err)
	}
	if _, err := runADB("reverse", "localabstract:"+config.SocketName, "tcp:"+port); err != nil {
		return err
	}

	remoteCommand := fmt.Sprintf(
		"nohup env CLASSPATH=/data/local/tmp/screen-sharing-agent.jar LD_LIBRARY_PATH=/data/local/tmp/.studio app_process /data/local/tmp com.android.tools.screensharing.Main --socket=%s --flags=5 --max_bit_rate=%d --codec=avc >/data/local/tmp/.studio/agent.log 2>&1 </dev/null & echo $! >/data/local/tmp/.studio/agent.pid",
		config.SocketName,
		config.BitRate,
	)
	if _, err := runADB("shell", remoteCommand); err != nil {
		return err
	}

	deadline := time.Now().Add(agentChannelTimeout)
	for time.Now().Before(deadline) {
		videoReady, audioReady, controlReady := agentChannelsReady()
		if videoReady && audioReady && controlReady {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("timed out waiting for the agent channels on %s (%s)%s", config.Serial, agentChannelSummary(videoReady, audioReady, controlReady), agentLogSuffix(config))
		case <-time.After(200 * time.Millisecond):
		}
	}
	videoReady, audioReady, controlReady := agentChannelsReady()
	return fmt.Errorf("agent process launched on %s but its channels did not connect (%s)%s", config.Serial, agentChannelSummary(videoReady, audioReady, controlReady), agentLogSuffix(config))
}

func agentChannelSummary(videoReady, audioReady, controlReady bool) string {
	return fmt.Sprintf("video=%t audio=%t control=%t", videoReady, audioReady, controlReady)
}

func agentLogSuffix(config agentConfig) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, config.ADBPath, "-s", config.Serial, "shell", "cat", "/data/local/tmp/.studio/agent.log")
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Sprintf("; unable to read agent log: %s", strings.TrimSpace(string(output)))
	}
	logText := strings.TrimSpace(string(output))
	if logText == "" {
		return "; agent log is empty"
	}
	if len(logText) > agentLogTailMaxLength {
		logText = logText[len(logText)-agentLogTailMaxLength:]
	}
	return "\nAgent log:\n" + logText
}

func remoteFileMatches(ctx context.Context, config agentConfig, localPath, remotePath string) bool {
	localBytes, err := os.ReadFile(localPath)
	if err != nil {
		return false
	}
	localHash := sha256.Sum256(localBytes)
	command := exec.CommandContext(ctx, config.ADBPath, "-s", config.Serial, "shell", "sha256sum", remotePath)
	output, err := command.Output()
	if err != nil {
		return false
	}
	fields := strings.Fields(string(output))
	return len(fields) != 0 && strings.EqualFold(fields[0], hex.EncodeToString(localHash[:]))
}

func requireFile(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("required agent artifact %q: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("required agent artifact %q is not a regular file", path)
	}
	return nil
}

func supportedAndroidABI(abi string) bool {
	switch abi {
	case "arm64-v8a", "armeabi-v7a", "x86", "x86_64":
		return true
	default:
		return false
	}
}
