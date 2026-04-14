export type MicRuntimeController = {
  startListening: () => Promise<void>;
  stopListening: () => void;
};

let micRuntimeController: MicRuntimeController | null = null;

export function registerMicRuntime(controller: MicRuntimeController) {
  micRuntimeController = controller;
  return () => {
    if (micRuntimeController === controller) {
      micRuntimeController = null;
    }
  };
}

export async function startGlobalMicListening() {
  if (!micRuntimeController) {
    throw new Error('Mic runtime is not mounted yet.');
  }

  await micRuntimeController.startListening();
}

export function stopGlobalMicListening() {
  micRuntimeController?.stopListening();
}
