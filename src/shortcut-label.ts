export function shortcutLabel(text: string, mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)): string {
  return mac ? text.replaceAll('Ctrl（Macは⌘）', '⌘').replaceAll('Ctrl / ⌘', '⌘').replaceAll('Alt / Option', 'Option').replaceAll('Ctrl', '⌘').replaceAll('Alt', 'Option').replaceAll('Delete / Backspace', 'delete').replaceAll('Delete', 'delete') : text.replaceAll('Ctrl（Macは⌘）', 'Ctrl').replaceAll('Ctrl / ⌘', 'Ctrl').replaceAll('Alt / Option', 'Alt');
}
