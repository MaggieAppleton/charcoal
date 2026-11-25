const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
}

function isEditable(target: Element | null): boolean {
  if (!target) return false
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled
  return target instanceof HTMLElement && target.isContentEditable
}

function normalizedName(file: File, index: number, total: number): File {
  const generic = !file.name || /^image(\.[a-z0-9]+)?$/i.test(file.name)
  if (!generic) return file
  const ext = EXTENSIONS[file.type] ?? 'png'
  const label = total > 1 ? `Pasted image ${index + 1}.${ext}` : `Pasted image.${ext}`
  return new File([file], label, {type: file.type, lastModified: file.lastModified})
}

export function clipboardImages(data: DataTransfer | null, activeElement: Element | null): File[] {
  if (!data) return []
  if (isEditable(activeElement) && data.getData('text/plain').trim().length > 0) return []

  const raw: File[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) raw.push(file)
  }
  if (!raw.length) {
    for (const file of Array.from(data.files ?? [])) {
      if (file.type.startsWith('image/')) raw.push(file)
    }
  }
  return raw.map((file, index) => normalizedName(file, index, raw.length))
}
