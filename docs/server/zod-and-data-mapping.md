# Zod and Data Mapping

Zod is used exclusively on the **server side** for validating incoming HTTP request bodies
before they are passed to services or the database. It is not used on the client.

## How Zod is Used

### 1. Defining schemas

Each controller or service file declares schemas at module scope using Zod primitives:

```typescript
// badge-state.service.ts
export const deviceBleStatusSchema = z.enum([
  'startup', 'scanning', 'connecting', 'connected', 'disconnected',
]);

export const statusBodySchema = z.object({
  controllerId: z.string().min(1),
  badgeId: z.string().min(1),
  bleStatus: deviceBleStatusSchema,
  batteryLevel: z.number().int().min(0).max(100).nullable().optional(),
  timestamp: z.string().datetime({ offset: true }).nullish(),
  pairName: z.string().optional(),
});
```

Common Zod primitives used across the codebase:

| Primitive | Example usage |
|---|---|
| `z.string()` | Free-form text, with `.min(1)` to reject blank strings |
| `z.string().regex()` | `objectIdSchema` — validates 24-char hex MongoDB ObjectIds |
| `z.string().datetime()` | ISO-8601 timestamp hints sent from controllers |
| `z.enum()` | Allowed string literals: BLE status, slot labels (A–E), game lifecycle states, roles |
| `z.number().int()` | Integer fields, optionally bounded with `.min()` / `.max()` |
| `z.boolean()` | Readiness flag |
| `z.array()` | Answer options and NFC card lists, with `.min(1)` to require at least one entry |
| `z.object()` | Nested structures (e.g. each answer option inside a question) |
| `.optional()` / `.nullable()` / `.nullish()` | Fields that may be absent or null |
| `.superRefine()` | Cross-field rules (e.g. `playMode` is required when `role` is `"player"`) |

### 2. Deriving TypeScript types

Where a schema is the single source of truth for a type, `z.infer` is used so the type
never drifts from the schema:

```typescript
// nfc-card.service.ts
export const nfcCardSchema = z.object({ ... });
export type NfcCard = z.infer<typeof nfcCardSchema>;

// badge-state.service.ts — method signature uses the inferred type directly
recordStatus(body: z.infer<typeof statusBodySchema>): void { ... }
```

#### Type drift

This happens when a manually written TypeScript type and the runtime validation schema are edited independently.

If a developer adds a `batteryLevel` field to a hand-written `StatusDto` interface but forgets to add it to the corresponding Zod schema, TypeScript is happy because the type says the field exists but the schema will strip or reject the field at runtime, causing a silent mismatch between what the code expects and what actually arrives.

The reverse is equally dangerous: adding a field to the schema without updating the type means the validated data carries a property that TypeScript does not know about, so it can never be accessed safely.

Using `z.infer` eliminates both failure modes because the TypeScript type is generated from the schema at compile time; they cannot diverge.

### 3. Validating request bodies at the controller boundary

Controllers type their `@Body()` parameter as `unknown` and call `.safeParse()` before
doing anything else. `safeParse` returns `{ success, data }` or `{ success: false, error }`
without throwing:

```typescript
// badges.controller.ts
postStatus(@Body() body: unknown, @Res() res: Response): void {
  const result = statusBodySchema.safeParse(body);
  if (!result.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: getValidationErrors(result.error),
    });
    return;
  }
  this.badgeStateService.recordStatus(result.data); // result.data is fully typed
}
```

When multiple parameters must be validated (route param + body), both are parsed and
their errors merged into a single 400 response:

```typescript
const gameIdResult  = objectIdSchema.safeParse(gameId);
const payloadResult = createGameSchema.safeParse(body);
if (!gameIdResult.success || !payloadResult.success) {
  const details = [
    ...(!gameIdResult.success  ? getValidationErrors(gameIdResult.error)  : []),
    ...(!payloadResult.success ? getValidationErrors(payloadResult.error) : []),
  ];
  res.status(400).json({ error: 'Validation failed', details });
  return;
}
```

### 4. Formatting validation errors

A shared helper converts `ZodError.issues` into a flat, client-readable array:

```typescript
function getValidationErrors(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || 'root',
    message: issue.message,
  }));
}
```

This helper is duplicated in each controller file that needs it
(`badges.controller.ts`, `pair-bindings.controller.ts`, `game-flow.controller.ts`).

### 5. Sharing schemas across files

Schemas defined in a service file are exported and imported by related controllers,
keeping the schema as a single source of truth:

```typescript
// badge-state.service.ts — exports schemas
export const statusBodySchema = z.object({ ... });
export const emojiBodySchema  = z.object({ ... });

// badges.controller.ts — imports and reuses them
import { emojiBodySchema, statusBodySchema } from './badge-state.service';
```

## Summary

Zod sits at the HTTP boundary: every `POST` endpoint accepts `body: unknown` and
validates it through a Zod schema before any business logic runs. A failed parse
short-circuits with a structured `400` response; a passing parse hands the strongly-typed
`result.data` to the service layer.

## Popular Alternatives to Zod

| Library | Key characteristics |
|---|---|
| **Valibot** | Modular, tree-shakeable design; very small bundle footprint; API similar to Zod |
| **Yup** | Mature, widely used in form libraries (Formik); schema chaining style; slightly larger runtime |
| **Joi** | Battle-tested Node.js validator; verbose but very flexible; no native TypeScript type inference |
| **Superstruct** | Lightweight; composable struct definitions; TypeScript inference without a code generator |
| **Arktype** | Near-zero runtime overhead; schema syntax mirrors TypeScript type syntax directly |
| **TypeBox** | Generates JSON Schema at runtime; ideal when you need both validation and an OpenAPI spec |
| **class-validator** | Decorator-based; pairs with `class-transformer`; popular in NestJS projects |
| **io-ts** | Functional/fp-ts style; very precise types; steeper learning curve |
