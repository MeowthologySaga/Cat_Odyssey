import { createMockGameHost, type MockHostOptions } from "./mockHost";

export type GameHostResolution = {
  host: LemGameHostApi;
  mode: "playzone" | "mock";
};

export type ResolveGameHostOptions = {
  injectedHost?: LemGameHostApi;
  mock?: MockHostOptions;
};

export function resolveGameHost(options: ResolveGameHostOptions = {}): GameHostResolution {
  const injectedHost = options.injectedHost ?? readInjectedHost();
  if (injectedHost) {
    return { host: injectedHost, mode: "playzone" };
  }
  return { host: createMockGameHost(options.mock), mode: "mock" };
}

export function createGameHost(options: ResolveGameHostOptions = {}): LemGameHostApi {
  return resolveGameHost(options).host;
}

function readInjectedHost(): LemGameHostApi | undefined {
  return typeof window !== "undefined" ? window.LEM_GAME_HOST_API : undefined;
}
