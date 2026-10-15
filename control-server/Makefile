SHELL := /bin/sh

AGENT_PROJECT := third_party/screen_sharing_service
AGENT_APP := $(AGENT_PROJECT)/app
AGENT_APK := $(AGENT_APP)/build/outputs/apk/debug/app-debug.apk
AGENT_LIBS := $(AGENT_APP)/build/intermediates/merged_native_libs/debug/mergeDebugNativeLibs/out/lib
DIST := dist
GOOS := $(shell go env GOOS)
GOARCH := $(shell go env GOARCH)
HOST_TARGET := $(GOOS)-$(GOARCH)
SERVER_EXT := $(if $(filter windows,$(GOOS)),.exe,)
SERVER_BINARY := control-server-$(HOST_TARGET)$(SERVER_EXT)
PLUGIN_BUNDLE := ../plugin/bundle/$(HOST_TARGET)
GO_TAGS ?=

.PHONY: all test benchmark frameprobe resourceprobe server agent plugin-bundle clean

all: test server agent plugin-bundle

test:
	go test -race -tags '$(GO_TAGS)' ./...
	go vet -tags '$(GO_TAGS)' ./...

benchmark:
	go test -tags '$(GO_TAGS)' -run '^$$' -bench JPEG -benchmem -count 3 .

frameprobe:
	@mkdir -p $(DIST)
	go build -o $(DIST)/frameprobe ./cmd/frameprobe

resourceprobe:
	@mkdir -p $(DIST)
	go build -o $(DIST)/resourceprobe ./cmd/resourceprobe

server:
	@mkdir -p $(DIST)
	CGO_ENABLED=1 go build -tags '$(GO_TAGS)' -o $(DIST)/$(SERVER_BINARY) .

agent:
	cd $(AGENT_PROJECT) && bash ./gradlew :app:assembleDebug
	@mkdir -p $(DIST)/agent-libs
	cp $(AGENT_APK) $(DIST)/screen-sharing-agent.jar
	@for abi in arm64-v8a armeabi-v7a x86 x86_64; do \
	  source="$(AGENT_LIBS)/$$abi/libscreen-sharing-agent.so"; \
	  if [ -f "$$source" ]; then \
	    mkdir -p "$(DIST)/agent-libs/$$abi"; \
	    cp "$$source" "$(DIST)/agent-libs/$$abi/libscreen-sharing-agent.so"; \
	  fi; \
	done

plugin-bundle: server agent
	@mkdir -p $(PLUGIN_BUNDLE)
	cp $(DIST)/$(SERVER_BINARY) $(PLUGIN_BUNDLE)/control-server$(SERVER_EXT)
	cp $(DIST)/screen-sharing-agent.jar $(PLUGIN_BUNDLE)/screen-sharing-agent.jar
	rm -rf $(PLUGIN_BUNDLE)/agent-libs
	cp -R $(DIST)/agent-libs $(PLUGIN_BUNDLE)/agent-libs

clean:
	rm -f $(DIST)/frameprobe
	rm -f $(DIST)/resourceprobe
	rm -f $(DIST)/control-server-* $(DIST)/control-server-*.exe $(DIST)/screen-sharing-agent.jar
	rm -rf $(DIST)/agent-libs
	rm -rf $(PLUGIN_BUNDLE)
