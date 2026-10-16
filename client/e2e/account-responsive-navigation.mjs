import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Exercise the production Account route and shell in Chromium with stable account state.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = process.cwd();
let releasePeoplePage;
const peoplePageGate = new Promise(resolveGate => { releasePeoplePage = resolveGate; });

const server = await createServer({
  configFile: false,
  root,
  plugins: [{
    name: 'account-navigation-fixtures',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'cookie') return '\0account-nav-cookie-fixture';
      if (id === 'set-cookie-parser') return '\0account-nav-set-cookie-fixture';
      if (id === 'firebase/auth') return '\0account-nav-firebase-auth';
      if (id === 'react-redux') return '\0account-nav-redux-fixture';
    },
    async load(id) {
      if (id === '\0account-nav-cookie-fixture') return 'export const parse=()=>({}); export const serialize=()=>""; export const parseCookie=parse; export const stringifyCookie=serialize; export const stringifySetCookie=serialize; export const parseSetCookie=()=>[]; export default {parse,serialize};';
      if (id === '\0account-nav-set-cookie-fixture') return 'export const splitCookiesString=(value)=>[value]; export default {splitCookiesString};';
      if (id === '\0account-nav-firebase-auth') return 'export const onAuthStateChanged=()=>()=>{}; export const getAuth=()=>({});';
      if (id === '\0account-nav-redux-fixture') return `export const Provider=({children})=>children;
        const state={undoable:{present:{preferences:{scrollbarWidth:'8px'}}}};
        export const useSelector=(selector)=>{try{return selector(state)}catch{return false}};
        export const useDispatch=()=>()=>{}; export const useStore=()=>({getState:()=>state,dispatch:()=>{}});`;
      const path = id.replaceAll('\\', '/');
      if (path.endsWith('/firebase/apps.ts')) return 'export const getHumanAuth=()=>({});';
      if (path.endsWith('/hooks/index.ts')) return `const state={undoable:{present:{preferences:{scrollbarWidth:'8px'}}}};
        export const useSelector=(selector)=>{try{return selector(state)}catch{return false}};
        export const useDispatch=()=>()=>{};`;
      if (path.endsWith('/context/globalInfo.tsx')) return `import {createContext} from 'react'; export const GlobalInfoContext=createContext({loginState:'success',sessionKind:'workstation',user:'Fixture Admin',userEmail:'admin@example.com',churchName:'Fixture Church',churchId:'fixture-church',role:'admin',activeInstances:[],churchBranding:null,notificationCategories:[],notificationPreferences:{},setNotificationPreference:()=>{}});`;
      if (path.endsWith('/context/controllerInfo.tsx')) return `import {createContext} from 'react'; export const ControllerInfoContext=createContext({});`;
      if (path.endsWith('/chat/ChatContext.tsx')) return `export const useChat=()=>({available:false,unreadCount:0,openChat:()=>{}}); export const ChatProvider=({children})=>children;`;
      if (path.endsWith('/Account/AccountPageContext.tsx')) return `export const AccountPageProvider=({children})=>children;
        export const useAccountPage=()=>({canManage:!location.hash.includes('denied=1'),churchId:'fixture-church',context:{churchId:'fixture-church'},toolbarLogos:null,loading:false,sortedInvites:[],sortedMembers:[],destructiveConfirm:null,destructiveConfirmRunning:false,destructiveModalProps:null,handleDestructiveConfirm:()=>{},setDestructiveConfirm:()=>{},refresh:()=>{},openMemberAccessSheet:()=>{},openInviteAccessSheet:()=>{},resendInvite:async()=>{},resendingInviteId:null});`;
      if (path.endsWith('/hooks/useAboutChangelogMenu.tsx')) return `export const useAboutChangelogMenu=()=>({aboutChangelogMenuItems:[{text:"What's New",to:'/whats-new'},{text:'About',to:'/about'}],aboutChangelogModals:null,updateReadyVersion:''});`;
      if (path.endsWith('/Account/pages/AccountPeoplePage.tsx')) {
        await peoplePageGate;
        return `export default function AccountPeoplePage(){return <section aria-label="Account people fixture" className="flex min-h-[1400px] flex-col gap-4"><h2>People</h2><label>Invite email<input aria-label="Invite email" /></label><div className="flex-1"/><button>Final account action</button></section>}`;
      }
      const pages = {
        AccountSetupPage: 'Devices & security',
        AccountControllersPage: 'Controllers',
        AccountBrandingPage: 'Branding',
        AccountIntegrationsPage: 'Integrations',
        AccountWorkspacePage: 'Workspace',
      };
      for (const [name, label] of Object.entries(pages)) {
        if (path.endsWith(`/Account/pages/${name}.tsx`)) return `export default function ${name}(){return <section aria-label="Account fixture page" className="flex min-h-[1400px] flex-col gap-4"><h2>${label}</h2><label>Fixture input<input aria-label="Fixture input" /></label><div className="flex-1"/><button>Final account action</button></section>}`;
      }
    },
    configureServer(serverInstance) {
      serverInstance.middlewares.use(async (req, res, next) => {
        if (req.url?.split('?')[0] === '/__e2e/release-people') {
          releasePeoplePage();
          res.end('released');
          return;
        }
        if (req.url?.split('?')[0] === '/account-navigation') {
          res.setHeader('Content-Type', 'text/html');
          res.end(await serverInstance.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body><div id="root"></div><script type="module" src="/e2e/account-responsive-navigation-entry.tsx"></script></body></html>'));
          return;
        }
        next();
      });
    },
  }, react()],
  optimizeDeps: { entries: ['e2e/account-responsive-navigation-entry.tsx'], esbuildOptions: { absWorkingDir: root } },
  cacheDir: resolve(root, 'node_modules/.vite-account-navigation'),
  appType: 'custom',
  resolve: { alias: { '@': resolve(root, 'src') } },
  server: { host: '127.0.0.1', port: 3108, strictPort: true },
});

await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.on('pageerror', error => console.error('BROWSER ERROR', error.message));

  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('http://127.0.0.1:3108/account-navigation#/account/people');
  await page.getByRole('status', { name: 'Loading administration page' }).waitFor();
  const mobilePrimary = page.getByRole('navigation', { name: 'Primary navigation' });
  assert.equal(await mobilePrimary.getByRole('link').count(), 3, 'mobile bottom bar must have exactly three destinations');
  assert.equal(await mobilePrimary.getByRole('link', { name: 'Access' }).getAttribute('aria-current'), 'page');
  const pendingToolbar = page.locator('[data-app-toolbar]');
  await mobilePrimary.getByRole('link', { name: 'Service Tools' }).click();
  await page.getByRole('navigation', { name: 'Service Tools pages' }).getByRole('tab', { name: 'Controllers' }).waitFor();
  await page.request.get('http://127.0.0.1:3108/__e2e/release-people');
  await page.getByRole('heading', { name: 'Controllers' }).waitFor();
  assert.equal(await page.locator('[data-app-toolbar]').getByRole('heading').count(), 0, 'mobile toolbar should omit the redundant page title');
  assert.equal((await pendingToolbar.boundingBox()).height, 48, 'compact toolbar should be 48px');
  const workspaceTabs = page.getByRole('navigation', { name: 'Service Tools pages' });
  assert.equal(await page.getByRole('tab', { name: 'Controllers' }).getAttribute('aria-selected'), 'true', 'the default route should be selected immediately');
  const scrollport = page.locator('[data-account-scrollport]');
  await page.getByRole('textbox', { name: 'Fixture input' }).waitFor();
  const fixedToolbarBefore = await pendingToolbar.boundingBox();
  const fixedTabsBefore = await workspaceTabs.boundingBox();
  await scrollport.evaluate(element => { element.scrollTop = element.scrollHeight; });
  const finalAction = page.getByRole('button', { name: 'Final account action' });
  const finalActionBox = await finalAction.boundingBox();
  const finalBottomNav = await mobilePrimary.boundingBox();
  const fixedToolbarAfter = await pendingToolbar.boundingBox();
  const fixedTabsAfter = await workspaceTabs.boundingBox();
  assert(fixedToolbarBefore && fixedToolbarAfter && Math.abs(fixedToolbarBefore.y - fixedToolbarAfter.y) < 1, 'compact toolbar must remain visible while content scrolls');
  assert(fixedTabsBefore && fixedTabsAfter && Math.abs(fixedTabsBefore.y - fixedTabsAfter.y) < 1, 'route tabs must remain visible while content scrolls');
  assert(finalActionBox && finalBottomNav && finalActionBox.y + finalActionBox.height <= finalBottomNav.y, 'final page action must scroll clear of the bottom bar');
  const focusedInput = page.getByRole('textbox', { name: 'Fixture input' });
  await focusedInput.focus();
  await page.setViewportSize({ width: 320, height: 480 });
  await focusedInput.evaluate(element => element.scrollIntoView({ block: 'center' }));
  const focusedInputBox = await focusedInput.boundingBox();
  const shortViewportBar = await mobilePrimary.boundingBox();
  assert(focusedInputBox && shortViewportBar && focusedInputBox.y + focusedInputBox.height <= shortViewportBar.y, 'focused form input must stay reachable above the bottom bar in a short viewport');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole('button', { name: 'Open menu' }).click();
  const drawer = page.getByRole('dialog');
  for (const label of ['Home', "What's New", 'About', 'Access', 'Service Tools', 'Settings', 'Interface zoom']) {
    await drawer.getByText(label, { exact: true }).waitFor();
  }
  for (const label of ['People', 'Devices & security', 'Controllers', 'Workspace', 'Branding', 'Integrations', 'Data export']) {
    await drawer.getByRole('link', { name: label }).waitFor();
  }
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('http://127.0.0.1:3108/account-navigation#/account/data-transfer');
  const dataExportButton = page.getByRole('button', { name: 'Download all CSVs' });
  await dataExportButton.waitFor();
  const tabs = page.getByRole('navigation', { name: 'Settings pages' });
  await page.waitForFunction(() => {
    const nav = document.querySelector('nav[aria-label="Settings pages"]')?.getBoundingClientRect();
    const tab = document.querySelector('nav[aria-label="Settings pages"] [role="tab"][aria-selected="true"]')?.getBoundingClientRect();
    return Boolean(nav && tab && tab.left >= nav.left - 1 && tab.right <= nav.right + 1);
  });
  assert.equal(await tabs.getByRole('tab', { name: 'Data export' }).getAttribute('aria-selected'), 'true');
  const toolbar = await page.locator('[data-app-toolbar]').boundingBox();
  const tabsBox = await tabs.boundingBox();
  assert(toolbar && tabsBox && Math.abs(tabsBox.y - (toolbar.y + toolbar.height)) < 1, 'route tabs must sit directly below the toolbar');
  const primaryBox = await page.getByRole('navigation', { name: 'Primary navigation' }).boundingBox();
  const workspace = await page.locator('[data-account-workspace]').boundingBox();
  assert(primaryBox && workspace && Math.abs(workspace.y + workspace.height - primaryBox.y) <= 2, 'workspace must end above the fixed bottom navigation');
  const downloadBox = await dataExportButton.boundingBox();
  assert(downloadBox && primaryBox && downloadBox.y + downloadBox.height <= primaryBox.y, 'real Data export action must remain clear of the bottom bar');

  await page.goto('http://127.0.0.1:3108/account-navigation#/account/integrations');
  await page.getByRole('heading', { name: 'Integrations' }).waitFor({ timeout: 5000 }).catch(async () => {
    console.error('Integration route debug', page.url(), await page.locator('body').innerText());
    throw new Error('The direct integrations page did not load.');
  });
  assert.match(page.url(), /#\/account\/integrations$/, 'direct deep links should preserve the existing route');
  assert.equal(await page.getByRole('tab', { name: 'Integrations' }).getAttribute('aria-selected'), 'true');

  await page.goto('http://127.0.0.1:3108/account-navigation#/account?tab=integrations');
  await page.getByRole('heading', { name: 'Integrations' }).waitFor();
  assert.match(page.url(), /#\/account\/integrations$/, 'legacy tab links should redirect to their existing route');
  assert.equal(await page.getByRole('tab', { name: 'Integrations' }).getAttribute('aria-selected'), 'true');

  await page.goto('http://127.0.0.1:3108/account-navigation#/account/workspace?denied=1');
  await page.getByText('You need admin access to manage this church.').waitFor();
  assert.equal(await page.getByRole('navigation', { name: 'Primary navigation' }).count(), 0, 'restricted users must not receive the new shortcuts');
  assert.equal(await page.getByRole('navigation', { name: 'Church administration sections' }).count(), 0, 'restricted users must not receive administration links');

  for (const [width, height] of [[375, 812], [390, 844], [768, 1024], [844, 600], [1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`http://127.0.0.1:3108/account-navigation?viewport=${width}x${height}#/account/data-transfer`);
    await page.getByRole('button', { name: 'Download all CSVs' }).waitFor();
    const mobile = width < 1024;
    assert.equal(await page.getByRole('navigation', { name: 'Primary navigation' }).isVisible(), mobile, `bottom bar visibility at ${width}px`);
    assert.equal(await page.getByRole('navigation', { name: 'Church administration sections' }).isVisible(), !mobile, `desktop sidebar visibility at ${width}px`);
    assert.equal(await page.getByRole('navigation', { name: 'Settings pages' }).isVisible(), mobile, `route tab visibility at ${width}px`);
    const rootBounds = await page.locator('main').first().boundingBox();
    const workspaceBounds = await page.locator('[data-account-workspace]').boundingBox();
    if (mobile) {
      const bottomBounds = await page.getByRole('navigation', { name: 'Primary navigation' }).boundingBox();
      assert(rootBounds && workspaceBounds && bottomBounds && Math.abs(workspaceBounds.y + workspaceBounds.height - bottomBounds.y) <= 2, `mobile workspace clearance at ${width}px`);
    } else {
      assert(rootBounds && workspaceBounds && Math.abs(workspaceBounds.y + workspaceBounds.height - (rootBounds.y + rootBounds.height)) <= 2, `desktop workspace should fill its viewport at ${width}px`);
      const sidebar = page.getByRole('navigation', { name: 'Church administration sections' });
      assert.equal(await sidebar.getByRole('link').count(), 7);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `horizontal overflow at ${width}px`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopSidebar = page.getByRole('navigation', { name: 'Church administration sections' });
  for (const [label, route] of [['People', 'people'], ['Devices & security', 'setup'], ['Controllers', 'controllers'], ['Workspace', 'workspace'], ['Branding', 'branding'], ['Integrations', 'integrations'], ['Data export', 'data-transfer']]) {
    await desktopSidebar.getByRole('link', { name: label }).click();
    await page.waitForURL(new RegExp(`#/account/${route}$`));
    await page.getByRole('heading', { name: label }).waitFor();
    if (route === 'controllers') {
      const desktopScrollport = page.locator('[data-account-scrollport]');
      const desktopToolbarBefore = await page.locator('[data-app-toolbar]').boundingBox();
      await desktopScrollport.evaluate(element => { element.scrollTop = element.scrollHeight; });
      const finalAction = await page.getByRole('button', { name: 'Final account action' }).boundingBox();
      const scrollBounds = await desktopScrollport.boundingBox();
      const desktopToolbarAfter = await page.locator('[data-app-toolbar]').boundingBox();
      assert(finalAction && scrollBounds && finalAction.y + finalAction.height <= scrollBounds.y + scrollBounds.height, 'desktop internal scroll should reach the final page action');
      assert(desktopToolbarBefore && desktopToolbarAfter && Math.abs(desktopToolbarBefore.y - desktopToolbarAfter.y) < 1, 'desktop toolbar should remain in place during content scrolling');
      await desktopScrollport.evaluate(element => { element.scrollTop = 0; });
    }
  }

  console.log('PASS Account navigation: 320–1440px shell geometry, seven desktop routes, mobile group/tab selection, legacy redirects, permission gating, and real Data export page.');
} finally {
  releasePeoplePage();
  await browser.close();
  await server.close();
}
