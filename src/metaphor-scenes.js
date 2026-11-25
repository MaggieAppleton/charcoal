/** @param {string} scene */
export function normalizeMetaphorScene(scene) {
  return scene.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')
}
