/**
 * Multi-provider model factory for the chat runtime. Maps a model id + the per-project
 * credentials (from VPS, Option A) to an AI SDK LanguageModel. Provider is inferred from
 * the model id prefix (mirrors the web app's detectProviderFromModelId).
 *
 * MVP covers the key-based providers (OpenAI / Anthropic / Google). Azure (creds.azure,
 * no apiKey) is not wired yet — the caller returns 501 for that case.
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import type { LlmCredentials } from './agent-core'

export function createChatModel(creds: LlmCredentials): LanguageModel {
  if (!creds.apiKey) {
    throw new Error('LLM credentials have no apiKey (Azure/non-key providers not supported yet)')
  }
  const id = creds.model
  if (id.startsWith('claude')) {
    return createAnthropic({ apiKey: creds.apiKey })(id)
  }
  if (id.startsWith('gemini')) {
    return createGoogleGenerativeAI({ apiKey: creds.apiKey })(id)
  }
  // default: OpenAI family (gpt-*, o*, etc.)
  return createOpenAI({ apiKey: creds.apiKey })(id)
}
