export type SoundRuntimeController = {
  togglePreview: (soundPath: string) => Promise<void>;
  stop: () => void;
};

let soundRuntimeController: SoundRuntimeController | null = null;

export function registerSoundRuntime(controller: SoundRuntimeController) {
  soundRuntimeController = controller;
  return () => {
    if (soundRuntimeController === controller) {
      soundRuntimeController = null;
    }
  };
}

export async function toggleGlobalSoundPreview(soundPath: string) {
  if (!soundRuntimeController) {
    throw new Error('Sound preview runtime is not mounted yet.');
  }

  await soundRuntimeController.togglePreview(soundPath);
}

export function stopGlobalSoundPreview() {
  soundRuntimeController?.stop();
}
