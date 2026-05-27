import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CoreDeps, ToolHandler } from './tools.js';
import { createTools } from './tools.js';
import type { ResourceDeps, ResourceHandler } from './resources.js';
import { createResources } from './resources.js';
import type { PromptHandler } from './prompts.js';
import { createPrompts } from './prompts.js';

export interface ServerHandle {
  readonly server: Server;
  readonly tools: readonly ToolHandler[];
  readonly resources: readonly ResourceHandler[];
  readonly prompts: readonly PromptHandler[];
}

export interface BuildServerOptions {
  readonly name?: string;
  readonly version?: string;
  readonly coreDeps: CoreDeps;
  readonly resourceDeps: ResourceDeps;
}

const DEFAULT_NAME = 'jobhelp-mcp';
const DEFAULT_VERSION = '0.2.0';

export function buildServer(opts: BuildServerOptions): ServerHandle {
  const tools = createTools(opts.coreDeps);
  const resources = createResources(opts.resourceDeps);
  const prompts = createPrompts();

  const server = new Server(
    {
      name: opts.name ?? DEFAULT_NAME,
      version: opts.version ?? DEFAULT_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  const toolByName = new Map<string, ToolHandler>();
  for (const t of tools) toolByName.set(t.definition.name, t);

  const resourceByUri = new Map<string, ResourceHandler>();
  for (const r of resources) resourceByUri.set(r.descriptor.uri, r);

  const promptByName = new Map<string, PromptHandler>();
  for (const p of prompts) promptByName.set(p.definition.name, p);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.definition.name,
      description: t.definition.description,
      inputSchema: t.definition.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const handler = toolByName.get(req.params.name);
    if (handler === undefined) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: false,
                error: { type: 'not_found', message: `unknown tool: ${req.params.name}` },
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
    const response = await handler.invoke(req.params.arguments);
    const result: {
      content: readonly { type: 'text'; text: string }[];
      isError?: boolean;
    } = {
      content: response.content,
    };
    if (response.isError === true) {
      return { ...result, isError: true };
    }
    return result;
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resources.map((r) => ({
      uri: r.descriptor.uri,
      name: r.descriptor.name,
      description: r.descriptor.description,
      mimeType: r.descriptor.mimeType,
    })),
  }));

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    _meta: {},
    prompts: prompts.map((p) => ({
      name: p.definition.name,
      description: p.definition.description,
      arguments: p.definition.arguments,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const handler = promptByName.get(req.params.name);
    if (handler === undefined) {
      throw new Error(`unknown prompt: ${req.params.name}`);
    }
    return handler.get(req.params.arguments);
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const handler = resourceByUri.get(req.params.uri);
    if (handler === undefined) {
      return {
        contents: [
          {
            uri: req.params.uri,
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                ok: false,
                error: { type: 'not_found', message: `unknown resource: ${req.params.uri}` },
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }
    const response = await handler.read();
    if (response.isError === true) {
      return { contents: response.contents, isError: true };
    }
    return { contents: response.contents };
  });

  return { server, tools, resources, prompts };
}

export async function runStdio(handle: ServerHandle): Promise<void> {
  const { StdioServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/stdio.js'
  );
  const transport = new StdioServerTransport();
  await handle.server.connect(transport);
}
