// Tiny pure helpers shared by several modules.

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
