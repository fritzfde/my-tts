export type LiveRuntimeController = {
  connectYouTube: () => Promise<void>;
  disconnectYouTube: () => void;
  connectTikTok: (username?: string) => Promise<void>;
  disconnectTikTok: () => Promise<void>;
};

let liveRuntimeController: LiveRuntimeController | null = null;

export function registerLiveRuntime(controller: LiveRuntimeController) {
  liveRuntimeController = controller;
  return () => {
    if (liveRuntimeController === controller) {
      liveRuntimeController = null;
    }
  };
}

export async function connectGlobalYouTubeRuntime() {
  if (!liveRuntimeController) {
    throw new Error('Live runtime is not mounted yet.');
  }

  await liveRuntimeController.connectYouTube();
}

export function disconnectGlobalYouTubeRuntime() {
  liveRuntimeController?.disconnectYouTube();
}

export async function connectGlobalTikTokRuntime(username?: string) {
  if (!liveRuntimeController) {
    throw new Error('Live runtime is not mounted yet.');
  }

  await liveRuntimeController.connectTikTok(username);
}

export async function disconnectGlobalTikTokRuntime() {
  if (!liveRuntimeController) {
    return;
  }

  await liveRuntimeController.disconnectTikTok();
}
