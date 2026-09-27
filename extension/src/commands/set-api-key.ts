/**
 * commands/set-api-key.ts — interlens.setApiKey command handler.
 *
 * Prompts the user for an API key for the currently configured provider
 * (or an optionally passed provider) and stores it in VS Code SecretStorage.
 */

import * as vscode from 'vscode';
import type { LLMProviderId } from '@interlens/core';
import { storeApiKey } from '../secrets';

export function registerSetApiKeyCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'interlens.setApiKey',
    async (providerOverride?: LLMProviderId) => {
      const provider: LLMProviderId =
        providerOverride ??
        (vscode.workspace.getConfiguration('interlens.llm').get<string>('provider') as LLMProviderId) ??
        'ibm-bob';

      const key = await vscode.window.showInputBox({
        title: `InterLens: Set API key for "${provider}"`,
        prompt: `Enter your API key for the "${provider}" provider. It will be stored securely in VS Code SecretStorage.`,
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => (v?.trim() ? undefined : 'API key cannot be empty'),
      });

      if (!key) return; // user cancelled

      await storeApiKey(context.secrets, provider, key.trim());
      await vscode.window.showInformationMessage(
        `InterLens: API key stored for "${provider}".`,
      );
    },
  );
}
