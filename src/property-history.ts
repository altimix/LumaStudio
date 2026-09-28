import type { KeyboardEvent } from 'react';
import { shortcutCommand } from './shortcuts';
import { useEditor } from './store';

export function propertyHistoryCommand(event: KeyboardEvent) {
  const command = shortcutCommand(event.nativeEvent, false);
  return command === 'undo' || command === 'redo' ? command : undefined;
}

export function handlePropertyHistory(event: KeyboardEvent<HTMLInputElement>) {
  const command = propertyHistoryCommand(event);
  if (!command) return;
  event.preventDefault(); event.stopPropagation();
  if (!event.repeat && !useEditor.getState().gestureActive) useEditor.getState()[command]();
}
