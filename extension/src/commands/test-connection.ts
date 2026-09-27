/**
 * commands/test-connection.ts — interlens.testConnection command handler.
 *
 * Calls provider.testConnection() and shows an information or error message.
 */

import * as vscode from 'vscode';
import { createProvider } from '@interlens/core';
import type { LLMProviderId } from '@interlens/core';
import { getApiKey, redactKey } from '../secrets';

export function registerTestConnectionCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'interlens.testConnection',
    async () => {
      const cfg = vscode.workspace.getConfiguration('interlens.llm');
      const provider = (cfg.get<string>('provider') ?? 'ibm-bob') as LLMProviderId;
      const baseUrl   = cfg.get<string>('baseUrl') ?? '';
      const model     = cfg.get<string>('model') ?? '';
      const teamId    = cfg.get<string>('bobTeamId') ?? '';
      const timeoutMs = cfg.get<number>('timeoutMs') ?? 20_000;
      const apiKey    = (await getApiKey(context.secrets, provider)) ?? '';

      const llmProvider = createProvider({
        provider,
        apiKey,
        baseUrl,
        model,
        teamId,
        timeoutMs,
      });

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `InterLens: Testing connection to "${provider}"…`,
          cancellable: false,
        },
        async () => {
          const result = await llmProvider.testConnection();
          if (result.ok) {
            await vscode.window.showInformationMessage(
              `InterLens: Connection to "${provider}" succeeded.`,
            );
          } else {
            const errMsg = redactKey(result.error ?? 'Unknown error', apiKey);
            await vscode.window.showErrorMessage(
              `InterLens: Connection to "${provider}" failed: ${errMsg}`,
            );
          }
        },
      );
    },
  );
}
