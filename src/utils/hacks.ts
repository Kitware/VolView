/**
 * document.exitPointerLock is undefined on iOS.
 * - Tested on iOS Safari 15.6.1.
 */
export function patchExitPointerLock() {
  const { exitPointerLock } = document;
  document.exitPointerLock = () => {
    try {
      exitPointerLock?.call(document);
    } catch {
      // ignore if undefined
    }
  };
}
