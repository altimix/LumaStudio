export function shortcutLabel(text: string, mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)): string {
  return mac ? text.replaceAll('Ctrl（Macは⌘）', '⌘').replaceAll('Ctrl / ⌘', '⌘').replaceAll('Alt / Option', 'Option').replace(/\bCtrl\b/g, '⌘').replace(/\bAlt\b/g, 'Option').replaceAll('Delete / Backspace', 'delete').replace(/\bDelete\b/g, 'delete') : text.replaceAll('Ctrl（Macは⌘）', 'Ctrl').replaceAll('Ctrl / ⌘', 'Ctrl').replaceAll('Alt / Option', 'Alt');
}
