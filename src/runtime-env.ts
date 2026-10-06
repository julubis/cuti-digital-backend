type RuntimeGlobal = typeof globalThis & {
	process?: { env?: Record<string, string | undefined> };
};

export const env = (globalThis as RuntimeGlobal).process?.env ?? {};
