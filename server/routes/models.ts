import { z } from "zod";
import { describeError } from "@/lib/ai/errors";
import { listModels } from "@/lib/ai/list-models";
import { credentialsSchema, providerIdSchema } from "@/lib/ai/request";

const bodySchema = z.object({
  provider: providerIdSchema,
  credentials: credentialsSchema,
});

/** Lists a provider's models with the user's own key. Nothing is stored. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  try {
    return Response.json(await listModels(parsed.data.provider, parsed.data.credentials));
  } catch (error) {
    return Response.json(
      { error: describeError(error, parsed.data.credentials.apiKey) },
      { status: 502 },
    );
  }
}
