import { z } from "zod";
import { credentialsSchema, effortSchema, modelRefSchema } from "@/lib/ai/request";

export const actions = ["rewrite", "shorten", "expand", "summarize", "custom", "continue"] as const;
export const scopes = ["block", "section", "whole", "insert"] as const;
export type MarkdownAiAction = (typeof actions)[number];
export type MarkdownAiScope = (typeof scopes)[number];
export const maxMarkdownContext = 500_000;
export const maxTarget = 250_000;
export const maxInstruction = 10_000;

export interface Target {
    from: number;
    to: number;
}

export const markdownEditRequest = z
    .object({
        model: modelRefSchema,
        credentials: credentialsSchema,
        effort: effortSchema,
        operation: z.enum([...actions, "refine"]),
        instruction: z.string().max(maxInstruction).optional(),
        document: z.object({
            kind: z.enum(["note", "skill", "studio-output"]),
            title: z.string().max(500),
        }),
        markdown: z.string().max(maxMarkdownContext),
        // Offsets are relative to the supplied slice, including when context is partial.
        target: z.object({
            from: z.number().int().nonnegative(),
            to: z.number().int().nonnegative(),
        }),
        original: z.string().max(maxTarget),
        previous: z.string().max(maxTarget).optional(),
        partial: z.boolean().default(false),
        deletionMarker: z
            .string()
            .regex(/^BETTER_VAULT_DELETE_[A-Za-z0-9]{16}$/)
            .optional(),
    })
    .refine(
        ({ markdown, target, original, operation, instruction, previous }) =>
            target.from <= target.to &&
            target.to <= markdown.length &&
            markdown.slice(target.from, target.to) === original &&
            (operation !== "continue" || target.from === target.to) &&
            (!["rewrite", "shorten", "expand", "summarize"].includes(operation) ||
                original.trim().length > 0) &&
            (!(operation === "custom" || operation === "refine") || Boolean(instruction?.trim())) &&
            (operation !== "refine" || previous !== undefined),
    );

export type MarkdownEditRequest = z.infer<typeof markdownEditRequest>;
