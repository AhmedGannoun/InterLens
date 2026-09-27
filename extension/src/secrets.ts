/**
 * secrets.ts — SecretStorage wrapper with key redaction.
 *
 * API keys are stored in VS Code's encrypted secret storage.
 * They are NEVER written to settings.json, .interlens.yml, workspace files,
 * Git refs, the output channel, or any log.
 *
 * redactKey() must be called on any error string before surfacing it to the user.
 */

import type * as vscode from 'vscode';
import type { LLMProviderId } from '@interlens/core';

/** Builds the storage key for a given provider. */
function secretKey(provider: LLMProviderId): string {
  return `interlens.apiKey.${provider}`;
}

/** Store an API key for a provider in VS Code SecretStorage. */
export async function storeApiKey(
  secrets: vscode.SecretStorage,
  provider: LLMProviderId,
  key: string,
): Promise<void> {
  await secrets.store(secretKey(provider), key);
}

/** Retrieve an API key for a provider from VS Code SecretStorage. */
export async function getApiKey(
  secrets: vscode.SecretStorage,
  provider: LLMProviderId,
): Promise<string | undefined> {
  return secrets.get(secretKey(provider));
}

/** Delete an API key for a provider from VS Code SecretStorage. */
export async function deleteApiKey(
  secrets: vscode.SecretStorage,
  provider: LLMProviderId,
): Promise<void> {
  await secrets.delete(secretKey(provider));
}

/**
 * Replace any occurrence of the stored key value in an error string with [REDACTED].
 * Call this before surfacing any error message from an LLM call.
 */
export function redactKey(errorText: string, keyValue: string | undefined): string {
  if (!keyValue || keyValue.length === 0) return errorText;
  // Escape special regex characters in the key value
  const escaped = keyValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return errorText.replace(new RegExp(escaped, 'g'), '[REDACTED]');
}
