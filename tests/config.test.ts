import assert from "node:assert/strict";
import { test } from "node:test";
import { assertApiDeploymentConfig, type Config } from "../apps/server/src/config.ts";

const sampleConfig: Config = {
  mode: "sample",
  port: 8787,
  host: "127.0.0.1",
  publicUrl: "http://localhost:8787",
  dataDir: ".openmuse",
  agentBackend: "sample",
  googleRedirectUri: "http://localhost:8787/api/google/callback",
  allowedOrigins: ["http://localhost:8081"],
};

function liveConfig(intelligenceApiKey?: string): Config {
  return {
    ...sampleConfig,
    mode: "live",
    agentBackend: "model",
    intelligenceApiKey,
  };
}

test("assertApiDeploymentConfig does not require vendor key in any mode", () => {
  for (const mode of [sampleConfig, liveConfig()]) {
    for (const key of [undefined, "", " \t\n", "any-key"]) {
      assert.doesNotThrow(() => assertApiDeploymentConfig({ ...mode, intelligenceApiKey: key }));
    }
  }
});
