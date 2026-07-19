/**
 * Marketing-site configuration.
 *
 * APP_URL — where the "Log in" / "Get started" CTAs point (the manager web app).
 * The manager app is not deployed to a public URL yet, so this defaults to the
 * relative placeholder '/app'. When the app is hosted, override via the Vite env
 * var VITE_APP_URL (e.g. https://app.sitelink.example) at build time — no code
 * change needed.
 */
export const APP_URL: string = import.meta.env.VITE_APP_URL || '/app';

/** Contact address used by the "Request a demo" / footer mailto links. */
export const CONTACT_EMAIL = 'hello@sitelink.example';
