import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { RequestId } from './common/identifiers.js';
import { ResourceVersion, SchemaVersion } from './common/versions.js';
import { HealthResponse } from './health.js';
import { API_ROUTES, COMPONENTS, type RouteResponse } from './registry.js';

/**
 * OpenAPI composition boundary.
 *
 * This is the ONLY module that extends Zod for OpenAPI. Leaf schema modules stay
 * plain and browser-safe; here we extend once, register the named components,
 * and compose response/request bodies as `$ref`s to those components so the
 * document is normalized (no giant inline duplication). Every monetary field is
 * a canonical decimal integer string in minor units.
 *
 * Each registered component is the SINGLE authoritative schema (the same object
 * used for runtime validation), so the public OpenAPI contract advertises exactly
 * what the runtime accepts — there is no weaker OpenAPI-only twin. The canonical
 * event's amount/currency co-presence and source/environment rules are encoded
 * structurally as oneOf/allOf.
 */
extendZodWithOpenApi(z);

const toOpenApiPath = (p: string): string => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

type ContentSchema = { content: { 'application/json': { schema: z.ZodTypeAny } } };

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();

  // Register components and keep the returned refs (these carry the $ref id).
  const refs = new Map<string, z.ZodTypeAny>();
  for (const { name, schema } of COMPONENTS) {
    refs.set(name, registry.register(name, schema));
  }
  const ref = (name: string): z.ZodTypeAny => {
    const r = refs.get(name);
    if (!r) throw new Error(`unknown component ref: ${name}`);
    return r;
  };

  // Envelope builders that embed component $refs in their `data` field.
  const apiEnv = (data: z.ZodTypeAny) =>
    z.object({ schema_version: SchemaVersion, request_id: RequestId, data }).strict();
  const mutEnv = (data: z.ZodTypeAny) =>
    z
      .object({
        schema_version: SchemaVersion,
        request_id: RequestId,
        resource_version: ResourceVersion,
        data,
      })
      .strict();
  const listEnv = (data: z.ZodTypeAny) =>
    apiEnv(z.object({ items: z.array(data), page_info: ref('PageInfo') }).strict());

  const responseSchema = (r: RouteResponse): z.ZodTypeAny => {
    switch (r.kind) {
      case 'error':
        return ref('ErrorEnvelope');
      case 'api':
        return apiEnv(ref(r.data));
      case 'mutation':
        return mutEnv(ref(r.data));
      case 'list':
        return listEnv(ref(r.data));
      default:
        throw new Error(`unknown response kind: ${String(r.kind)}`);
    }
  };

  // Health probe carried over from MT-001.
  registry.registerPath({
    method: 'get',
    path: '/health',
    summary: 'Liveness/health probe',
    responses: {
      200: {
        description: 'Service is healthy',
        content: { 'application/json': { schema: HealthResponse } },
      },
    },
  });

  for (const route of API_ROUTES) {
    const responses: Record<number, { description: string } & ContentSchema> = {};
    for (const r of route.responses) {
      responses[r.status] = {
        description: r.description,
        content: { 'application/json': { schema: responseSchema(r) } },
      };
    }

    const request: {
      params?: z.AnyZodObject;
      query?: z.AnyZodObject;
      body?: { description?: string; content: { 'application/json': { schema: z.ZodTypeAny } } };
    } = {};
    if (route.request?.params) request.params = route.request.params;
    if (route.request?.query) request.query = route.request.query;
    if (route.request?.body) {
      request.body = { content: { 'application/json': { schema: ref(route.request.body) } } };
    }
    if (route.request?.rawBody) {
      // Raw signed webhook bytes: type string / format binary. HMAC is verified
      // over the exact bytes BEFORE any JSON parsing.
      request.body = {
        description: route.request.rawBody.description,
        content: {
          'application/json': { schema: z.string().openapi({ format: 'binary' }) },
        },
      };
    }

    registry.registerPath({
      method: route.method,
      path: toOpenApiPath(route.path),
      summary: route.summary,
      ...(Object.keys(request).length > 0 ? { request } : {}),
      responses,
    });
  }

  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'MoneyTrace API',
      version: '0.1.0',
      description:
        'Financial revenue-integrity control plane (Buildathon prototype). Every ' +
        'monetary field is a canonical decimal integer string in minor units ' +
        '(never a JSON number); currency is required with every material amount.',
    },
  });
}
