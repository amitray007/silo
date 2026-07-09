import { captureActiveTab } from './capture-flow.js';
import { handleContextMenuClick, registerContextMenus } from './context-menu.js';

/**
 * The MV3 service worker — entry point for all THREE quiet-capture triggers
 * (toolbar action, `commands` keyboard shortcut, context menu). The toolbar
 * action has NO `default_popup`, so clicking the icon fires
 * `action.onClicked` (instant save). All THREE triggers (icon, keyboard
 * command, context menu) funnel through `runQuietCapture`.
 */

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus();
});

// `runQuietCapture` (the shared path both handlers below funnel through) is
// try/catch/re-throw: it shows the error toast itself, then re-throws so a
// caller COULD observe the failure. Neither trigger here needs to act on
// that rejection beyond what the toast already communicated to the user —
// but the `.catch` is explicit (ce-correctness finding) so a capture
// failure is a documented no-op here, not an unhandled promise rejection
// logged to the service worker's console.
chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture-page') {
    captureActiveTab().catch(() => {
      // Already reported via the toast inside runQuietCapture.
    });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab).catch(() => {
    // Already reported via the toast inside runQuietCapture.
  });
});

// The toolbar icon now has NO default_popup (manifest.json), so clicking it
// fires action.onClicked here — the instant-save path. Same shared
// runQuietCapture funnel as the keyboard command; failures are reported by
// the toast inside it, so the .catch is a documented no-op.
chrome.action.onClicked.addListener(() => {
  captureActiveTab().catch(() => {
    // Already reported via the toast inside runQuietCapture.
  });
});
