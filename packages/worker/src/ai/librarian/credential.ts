import { resolveAiCredential, resolveAiFeatureCredential } from '@silo/core/ai-credential';

export async function answerCredential(
  model: { provider: Parameters<typeof resolveAiCredential>[0]; id: string } | undefined,
) {
  return (
    (model ? await resolveAiCredential(model.provider, model.id) : undefined) ??
    (await resolveAiFeatureCredential('librarian'))
  );
}
