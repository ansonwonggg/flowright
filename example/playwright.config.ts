import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { flowkitProjects, flowkitReporters, loadEnvironment } from '../src/playwright.ts';
import { PORTAL } from './portal/fake-portal.ts';

const root = import.meta.dirname;
loadEnvironment(root);

export default defineConfig({
  testDir: root,
  outputDir: path.join(root, '../test-results'),
  workers: 1,
  reporter: flowkitReporters(root),
  use: { baseURL: PORTAL, trace: 'retain-on-failure' },
  projects: [{ name: 'admin-login', testMatch: /admin-login\.setup\.ts$/ }, ...flowkitProjects(root)],
});
