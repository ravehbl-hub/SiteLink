/**
 * @sitelink/shared — Barrel export.
 * The spine shared by both front ends and the back end (Architecture §2).
 * Framework-agnostic: no Prisma, no React. Prisma-generated types stay in the backend;
 * these hand-authored DTOs are the wire contract.
 */
export * from './enums';
export * from './common';
export * from './user';
export * from './site';
export * from './worker';
export * from './attendance';
export * from './salary';
export * from './finance';
export * from './dashboard';
export * from './request';
export * from './worker-rating';
export * from './billing';
