import { log } from '../lib/log.js';

export interface AliasMap {
  readonly canonical: ReadonlyMap<string, string>;
  readonly multiWordPhrases: readonly string[];
}

const RAW_ALIASES: Record<string, readonly string[]> = {
  kubernetes: ['k8s'],
  docker: ['dockerised', 'dockerized'],
  terraform: ['tf'],
  ansible: [],
  helm: [],
  istio: [],

  'amazon web services': ['aws'],
  'google cloud platform': ['gcp', 'google cloud'],
  azure: ['microsoft azure'],
  cloudflare: [],
  vercel: [],
  heroku: [],

  javascript: ['js', 'ecmascript'],
  typescript: ['ts'],
  go: ['golang'],
  python: ['py'],
  java: [],
  'c#': ['csharp', 'c sharp'],
  'c++': ['cpp', 'cplusplus'],
  rust: [],
  swift: [],
  kotlin: [],
  ruby: [],
  php: [],
  scala: [],
  elixir: [],
  haskell: [],

  postgresql: ['postgres', 'pg', 'psql'],
  mysql: [],
  mongodb: ['mongo'],
  redis: [],
  elasticsearch: ['elastic search'],
  cassandra: [],
  dynamodb: ['dynamo db'],
  sqlite: [],
  snowflake: [],
  bigquery: ['big query'],
  databricks: [],

  react: ['react.js', 'reactjs'],
  'node.js': ['node', 'nodejs'],
  'next.js': ['nextjs'],
  vue: ['vue.js', 'vuejs'],
  angular: ['angular.js', 'angularjs'],
  svelte: ['sveltejs'],
  django: [],
  flask: [],
  fastapi: ['fast api'],
  spring: ['spring boot', 'springboot'],
  rails: ['ruby on rails', 'ror'],
  laravel: [],
  express: ['expressjs', 'express.js'],
  nestjs: ['nest.js', 'nest'],
  'nuxt.js': ['nuxt', 'nuxtjs'],
  remix: ['remix.run', 'remixjs'],
  'solid.js': ['solid', 'solidjs'],
  actix: ['actix-web'],
  gin: ['gin-gonic'],
  podman: [],

  pytorch: ['torch'],
  tensorflow: ['tensor flow'],
  'scikit-learn': ['sklearn', 'scikit learn'],
  huggingface: ['hugging face'],
  'machine learning': ['ml'],
  'natural language processing': ['nlp'],
  'large language model': ['llm', 'llms'],
  'computer vision': ['cv'],
  'deep learning': ['dl'],
  pandas: [],
  numpy: ['num py'],

  jenkins: [],
  circleci: ['circle ci'],
  'github actions': ['gh actions'],
  gitlab: ['gitlab ci'],
  travisci: ['travis ci', 'travis'],
  'continuous integration': ['ci', 'ci/cd', 'cicd', 'continuous delivery'],

  datadog: ['data dog'],
  grafana: [],
  prometheus: [],
  sentry: [],
  splunk: [],
  newrelic: ['new relic'],

  kafka: ['apache kafka'],
  rabbitmq: ['rabbit mq'],
  sqs: ['amazon sqs'],
  pubsub: ['pub sub'],

  rest: ['restful', 'rest api'],
  graphql: ['gql'],
  grpc: [],
  websocket: ['web socket', 'websockets'],
  protobuf: ['protocol buffers'],

  jest: [],
  vitest: [],
  pytest: [],
  cypress: [],
  playwright: [],
  mocha: [],
  selenium: [],

  git: [],
  github: ['gh'],
  bitbucket: [],

  linux: [],
  unix: [],
  bash: ['shell'],
  vim: ['neovim', 'nvim'],
  emacs: [],
  vscode: ['vs code', 'visual studio code'],

  microservices: ['micro services', 'microservice'],
  'service oriented architecture': ['soa'],
  serverless: [],
  lambda: ['aws lambda'],
  s3: ['aws s3'],
  ec2: ['aws ec2'],
};

function toLookupKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '_');
}

function buildAliasMap(rawAliases: Record<string, readonly string[]> = RAW_ALIASES): AliasMap {
  const canonical = new Map<string, string>();
  const phrases = new Set<string>();
  for (const [rawCanon, variants] of Object.entries(rawAliases)) {
    const canon = rawCanon.toLowerCase().trim();
    if (canon.length === 0) {
      log('warn', 'skill_aliases.skipped_empty_canonical', { rawCanon });
      continue;
    }
    const canonKey = toLookupKey(canon);
    if (canon.includes(' ')) phrases.add(canon);
    canonical.set(canonKey, canon);
    for (const v of variants) {
      const vl = v.toLowerCase().trim();
      if (vl.length === 0) {
        log('warn', 'skill_aliases.skipped_empty_variant', { canonical: canon });
        continue;
      }
      if (vl.includes(' ')) phrases.add(vl);
      canonical.set(toLookupKey(vl), canon);
    }
  }
  return {
    canonical,
    multiWordPhrases: Array.from(phrases),
  };
}

let cached: AliasMap | undefined;

export function getAliasMap(): AliasMap {
  if (cached === undefined) cached = buildAliasMap();
  return cached;
}

export { buildAliasMap };

/**
 * Canonicalize a single token. Accepts either pre-tokenized form (with `_`
 * separators in place of spaces) or a free-form phrase (with spaces). Always
 * returns a lowercased string. Unmapped tokens are returned lowercased.
 */
export function canonicalize(token: string, map: AliasMap): string {
  const key = toLookupKey(token);
  const direct = map.canonical.get(key);
  if (direct !== undefined) return direct;
  return token.toLowerCase();
}

/**
 * Canonicalize an array of tokens, deduplicating the canonical result set.
 */
export function canonicalizeAll(
  tokens: readonly string[],
  map: AliasMap,
): readonly string[] {
  const seen = new Set<string>();
  for (const t of tokens) {
    seen.add(canonicalize(t, map));
  }
  return Array.from(seen);
}
