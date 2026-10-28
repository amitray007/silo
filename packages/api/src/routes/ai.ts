import {
  AI_FEATURES,
  AI_PROVIDER_KINDS,
  type AiFeatureDef,
  type AiProviderKind,
  type AiProviderSummary,
  type AiTestOutcome,
  aiStatus,
  defaultModelFor,
  InvalidAiApiKeyError,
  listAiProviders,
  refreshProviderModels,
  refreshStaleProviderModels,
  removeAiProvider,
  SecretKeyMissingError,
  saveAiProviderKey,
  testAiProvider,
} from '@silo/core';
import type { Hono } from 'hono';
import { z } from 'zod';
import { operatorOnly } from '../operator-only.js';

const kindParamSchema = z.object({ kind: z.enum(AI_PROVIDER_KINDS) });
const putBodySchema = z.object({ apiKey: z.string() });

const INVALID_KEY_BODY = {
  error: 'invalid_api_key',
  message: 'API key must be 8-300 printable ASCII characters.',
} as const;

function providerJson(p: AiProviderSummary) {
  return {
    kind: p.kind,
    models: (p.models ?? []).map((model) => ({
      id: model.id,
      label: model.label,
      owner: model.owner,
      createdAt: model.createdAt,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      structuredOutput: model.structuredOutput,
      reasoning: model.reasoning,
    })),
    defaultModel: defaultModelFor(p.kind, p.models ?? [])?.id ?? null,
    modelsFetchedAt: p.modelsFetchedAt?.toISOString() ?? null,
    modelsRefreshError: p.modelsRefreshError ?? null,
    configured: p.configured,
    keyLast4: p.keyLast4,
    keyReadable: p.keyReadable,
    lastTest: p.lastTest
      ? { ok: p.lastTest.ok, at: p.lastTest.at.toISOString(), code: p.lastTest.code }
      : null,
  };
}

function featuresJson() {
  return (AI_FEATURES as readonly AiFeatureDef[]).map((f) => ({
    id: f.id,
    label: f.label,
    description: f.description,
    plugin: f.plugin ?? null,
  }));
}

function parseKind(c: { req: { param(name: string): string } }): AiProviderKind {
  return kindParamSchema.parse({ kind: c.req.param('kind') }).kind;
}

/**
 * Optional-AI settings surface. Serializes only key-free core output
 * (`aiStatus`, `listAiProviders`, model/feature metadata, test outcomes).
 * Writes are operator-only (see `operator-only.ts`); `GET /ai` holds no secret.
 */
export function registerAiRoutes(app: Hono): void {
  app.get('/ai', async (c) => {
    const [status, providers] = await Promise.all([aiStatus(), listAiProviders()]);
    refreshStaleProviderModels(providers);
    return c.json({
      status,
      providers: providers.map(providerJson),
      features: featuresJson(),
    });
  });

  app.put('/ai/providers/:kind', operatorOnly, async (c) => {
    const kind = parseKind(c);
    const body = putBodySchema.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json(INVALID_KEY_BODY, 400);
    try {
      await saveAiProviderKey(kind, body.data.apiKey);
    } catch (error) {
      if (error instanceof InvalidAiApiKeyError) return c.json(INVALID_KEY_BODY, 400);
      if (error instanceof SecretKeyMissingError) {
        return c.json(
          {
            error: 'secret_key_missing',
            message: 'Set SILO_SECRET_KEY on the server to store keys.',
          },
          409,
        );
      }
      throw error;
    }
    const test = await testAiProvider(kind);
    const provider = (await listAiProviders()).find((p) => p.kind === kind);
    return c.json({ provider: provider ? providerJson(provider) : null, test: testJson(test) });
  });

  app.post('/ai/providers/:kind/test', operatorOnly, async (c) => {
    const kind = parseKind(c);
    return c.json(testJson(await testAiProvider(kind)));
  });

  app.post('/ai/providers/:kind/models/refresh', operatorOnly, async (c) => {
    const result = await refreshProviderModels(parseKind(c));
    return result.ok
      ? c.json(result)
      : c.json({ error: result.code, message: 'Could not refresh provider models.' }, 502);
  });

  app.delete('/ai/providers/:kind', operatorOnly, async (c) => {
    await removeAiProvider(parseKind(c));
    return c.body(null, 204);
  });
}

function testJson(outcome: AiTestOutcome) {
  return outcome.ok
    ? { ok: true, latencyMs: outcome.latencyMs }
    : 'latencyMs' in outcome
      ? { ok: false, code: outcome.code, latencyMs: outcome.latencyMs }
      : { ok: false, code: outcome.code };
}
