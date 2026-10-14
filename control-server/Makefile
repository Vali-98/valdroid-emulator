SHELL := /bin/sh

AGENT_PROJECT := third_party/screen_sharing_service
AGENT_APP := $(AGENT_PROJECT)/app
AGENT_APK := $(AGENT_APP)/build/outputs/apk/debug/app-debug.apk
AGENT_LIBS := $(AGENT_APP)/build/intermediates/merged_native_libs/debug/mergeDebugNativeLibs/out/lib
DIST := dist

.PHONY: all test server agent clean

all: test server agent

test:
	go test -race ./...
	go vet ./...

server:
	@mkdir -p $(DIST)
	CGO_ENABLED=1 go build -o $(DIST)/control-server-$(shell go env GOOS)-$(shell go env GOARCH) .

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

clean:
	rm -f $(DIST)/control-server-* $(DIST)/control-server-*.exe $(DIST)/screen-sharing-agent.jar
	rm -rf $(DIST)/agent-libs