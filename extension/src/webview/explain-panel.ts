/**
 * explain-panel.ts — Streaming Webview panel for the Explain command.
 *
 * Opens a VS Code WebviewPanel that renders an LLM explanation incrementally.
 * Tokens arrive via panel.webview.postMessage({ type: 'token', text }).
 * On stream end: { type: 'done' }.
 * On error:      { type: 'error', text: redactedMessage }.
 */

import * as vscode from 'vscode';
import type { Finding } from '@interlens/core';

/** Messages sent from the extension host to the webview. */
export type ExplainMessage =
  | { type: 'token'; text: string }
  | { type: 'done' }
  | { type: 'error'; text: string };

/** A handle returned by openExplainPanel that lets callers push tokens. */
export interface ExplainPanelHandle {
  /** Send a token to the webview for incremental rendering. */
  postToken(text: string): void;
  /** Signal that streaming is complete. */
  postDone(): void;
  /** Surface a (pre-redacted) error to the webview. */
  postError(redactedText: string): void;
  /** Abort controller: aborted when the user closes the panel. */
  signal: AbortSignal;
  /** Dispose the panel. */
  dispose(): void;
}

/**
 * Open a new streaming Explain webview panel.
 * Returns a handle for pushing tokens / completion / errors.
 */
export function openExplainPanel(
  context: vscode.ExtensionContext,
  finding: Finding,
): ExplainPanelHandle {
  const panel = vscode.window.createWebviewPanel(
    'interlens.explain',
    `InterLens: Explain — ${finding.type}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  const ac = new AbortController();

  panel.onDidDispose(() => ac.abort(), undefined, context.subscriptions);
  panel.webview.html = buildWebviewHtml(finding);

  return {
    postToken(text: string) {
      void panel.webview.postMessage({ type: 'token', text } satisfies ExplainMessage);
    },
    postDone() {
      void panel.webview.postMessage({ type: 'done' } satisfies ExplainMessage);
    },
    postError(redactedText: string) {
      void panel.webview.postMessage({ type: 'error', text: redactedText } satisfies ExplainMessage);
    },
    signal: ac.signal,
    dispose() {
      panel.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Webview HTML
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildWebviewHtml(finding: Finding): string {
  const escapedDesc = escapeHtml(finding.description);
  const escapedType = escapeHtml(finding.type);
  const escapedFile = escapeHtml(finding.myFile);

  // The inline script is built as a plain string to avoid backtick conflicts
  // in the outer template literal. The JS uses triple-backtick detection by
  // checking startsWith on a runtime-constructed string.
  const scriptBody = [
    '(function() {',
    '  "use strict";',
    '',
    '  var FENCE = "```";',
    '',
    '  // Minimal markdown-to-HTML renderer (no external dependency).',
    '  function renderMarkdown(md) {',
    '    var lines = md.split("\\n");',
    '    var html = "";',
    '    var inCode = false;',
    '    var codeBuf = "";',
    '',
    '    for (var i = 0; i < lines.length; i++) {',
    '      var line = lines[i];',
    '      if (line.indexOf(FENCE) === 0) {',
    '        if (inCode) {',
    '          html += "<pre><code>" + escHtml(codeBuf.replace(/\\n$/, "")) + "</code></pre>\\n";',
    '          inCode = false; codeBuf = "";',
    '        } else { inCode = true; }',
    '        continue;',
    '      }',
    '      if (inCode) { codeBuf += line + "\\n"; continue; }',
    '      var f = line',
    '        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")',
    '        .replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>")',
    '        .replace(/\\*(.+?)\\*/g, "<em>$1</em>")',
    '        .replace(/`([^`]+)`/g, "<code>$1</code>");',
    '      html += (f.trim() === "") ? "<p></p>\\n" : "<p>" + f + "</p>\\n";',
    '    }',
    '    if (inCode) { html += "<pre><code>" + escHtml(codeBuf) + "</code></pre>\\n"; }',
    '    return html;',
    '  }',
    '',
    '  function escHtml(s) {',
    '    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");',
    '  }',
    '',
    '  var rawText = "";',
    '  var spinner = document.getElementById("spinner");',
    '  var content = document.getElementById("content");',
    '  var errorBox = document.getElementById("error-box");',
    '',
    '  window.addEventListener("message", function(event) {',
    '    var msg = event.data;',
    '    if (msg.type === "token") {',
    '      rawText += msg.text;',
    '      if (spinner) { spinner.style.display = "none"; }',
    '      content.innerHTML = renderMarkdown(rawText);',
    '    } else if (msg.type === "done") {',
    '      if (spinner) { spinner.style.display = "none"; }',
    '      content.innerHTML = rawText ? renderMarkdown(rawText) : "<p><em>No explanation returned.</em></p>";',
    '    } else if (msg.type === "error") {',
    '      if (spinner) { spinner.style.display = "none"; }',
    '      errorBox.style.display = "block";',
    '      errorBox.textContent = "Error: " + msg.text;',
    '    }',
    '  });',
    '}());',
  ].join('\n');

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<title>InterLens: Explain</title>',
    '<style>',
    '  * { box-sizing: border-box; }',
    '  body {',
    '    font-family: var(--vscode-font-family, -apple-system, "Segoe UI", sans-serif);',
    '    font-size: var(--vscode-font-size, 13px);',
    '    color: var(--vscode-editor-foreground, #1f2328);',
    '    background: var(--vscode-editor-background, #fff);',
    '    margin: 0; padding: 16px 20px; line-height: 1.6;',
    '  }',
    '  header { border-bottom: 1px solid var(--vscode-panel-border, #e5e7eb); padding-bottom: 10px; margin-bottom: 16px; }',
    '  h1 { font-size: 1rem; margin: 0 0 4px; }',
    '  .meta { font-size: 0.85rem; color: var(--vscode-descriptionForeground, #57606a); }',
    '  #content { min-height: 40px; }',
    '  #spinner { color: var(--vscode-descriptionForeground, #57606a); font-style: italic; }',
    '  #error-box { display: none; background: var(--vscode-inputValidation-errorBackground, #f8d7da); border: 1px solid var(--vscode-inputValidation-errorBorder, #f5c6cb); color: var(--vscode-inputValidation-errorForeground, #721c24); padding: 8px 12px; border-radius: 4px; margin-top: 12px; }',
    '  pre, code { background: var(--vscode-textBlockQuote-background, #f7f8fa); border-radius: 3px; font-size: 0.9em; }',
    '  pre { padding: 8px 12px; overflow-x: auto; }',
    '  code { padding: 1px 4px; }',
    '  p { margin: 0 0 10px; }',
    '</style>',
    '</head>',
    '<body>',
    '<header>',
    '  <h1>InterLens: Explain</h1>',
    `  <div class="meta"><strong>${escapedType}</strong> &mdash; <code>${escapedFile}</code></div>`,
    `  <div class="meta" style="margin-top:4px">${escapedDesc}</div>`,
    '</header>',
    '<div id="content"><span id="spinner">Generating explanation&hellip;</span></div>',
    '<div id="error-box"></div>',
    '<script>',
    scriptBody,
    '<\/script>',
    '</body>',
    '</html>',
  ].join('\n');
}
