/**
 * commands/clear-api-key.ts — interlens.clearApiKey command handler.
 *
 * Deletes the stored API key for the currently configured provider.
 */

import * as vscode from 'vscode';
import type { LLMProviderId } from '@interlens/core';
import { deleteApiKey } from '../secrets';

export function registerClearApiKeyCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'interlens.clearApiKey',
    async (providerOverride?: LLMProviderId) => {
      const provider: LLMProviderId =
        providerOverride ??
        (vscode.workspace.getConfiguration('interlens.llm').get<string>('provider') as LLMProviderId) ??
        'ibm-bob';

      await deleteApiKey(context.secrets, provider);
      await vscode.window.showInformationMessage(
        `InterLens: API key cleared for "${provider}".`,
      );
    },
  );
}
