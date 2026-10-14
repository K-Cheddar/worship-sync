import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Run from client/: PLAYWRIGHT_MODULE_PATH may point to an existing Playwright installation.
// Real workspace, routes, guard, controls, styles and navigation; deterministic page/data fixtures.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = process.cwd();
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter, Routes, Route} from 'react-router-dom';
import TeamsAndServices from '/src/pages/Teams/TeamsAndServices';
import '/src/index.css';
createRoot(document.getElementById('root')).render(<HashRouter><Routes><Route path="/teams-and-services/*" element={<TeamsAndServices />}/><Route path="/home" element={<div>Home</div>}/></Routes></HashRouter>);`;
const server = await createServer({
  configFile: false, root,
  plugins: [{ name: 'navigation-fixtures', enforce: 'pre',
    resolveId(id) { if (id === '/navigation-fixture.tsx') return '\0navigation-fixture.tsx'; },
    async load(id) {
      if (id === '\0navigation-fixture.tsx') return (await transformWithEsbuild(fixture, 'fixture.tsx', {loader:'tsx',jsx:'automatic'})).code;
      const path = id.replaceAll('\\', '/');
      if (path.endsWith('/Teams/TeamsPageContext.tsx')) return `import {getAvailableTeamsNavSections} from '/src/pages/Teams/teamsNavSections';
        export const TeamsPageProvider = ({children}) => children;
        const availableNavSections = getAvailableTeamsNavSections({hasTeamsWorkspaceAccess:true,hasBroadTeamsReadAccess:true,canViewServices:!location.search.includes('restricted')});
        export const useTeamsPage = () => ({loading:false,accessDenied:false,canViewServices:true,availableNavSections});`;
      if (path.endsWith('/context/controllerInfo.tsx')) return `import {createContext} from 'react'; export const ControllerInfoContext=createContext({});`;
      if (path.endsWith('/context/globalInfo.tsx')) return `import {createContext} from 'react'; export const GlobalInfoContext=createContext({loginState:'loggedIn'});`;
      if (path.endsWith('/context/churchServiceTimeZone.tsx')) return `export const useChurchServiceTimeZone=()=>({timeZone:'America/New_York',isConfigured:true,status:'ready'});`;
      if (path.endsWith('/ToolbarElements/UserSection.tsx')) return `export default ()=>null;`;
      if (path.endsWith('/hooks/useAboutChangelogMenu.tsx')) return `export const useAboutChangelogMenu=()=>({aboutChangelogMenuItems:[{text:"What's New",onClick:()=>{}},{text:'About',onClick:()=>{}}],aboutChangelogModals:null,updateReadyVersion:''});`;
      if (/\/Teams\/pages\/Teams\w+Page\.tsx$/.test(path)) return `import React from 'react'; import {useLocation} from 'react-router-dom'; import {useTeamsNavigationGuard} from '/src/pages/Teams/TeamsNavigationGuardContext';
        export default function Page(){const {pathname}=useLocation(); const {setDirtySource}=useTeamsNavigationGuard(); React.useEffect(()=>()=>setDirtySource("fixture",false),[pathname,setDirtySource]); return <section aria-label="Fixture page" className="flex min-h-0 flex-1 flex-col"><h2>{pathname}</h2><button onClick={()=>setDirtySource("fixture",true)}>Mark dirty</button><input aria-label="Page input"/><div role="region" aria-label="Page scroll" className="min-h-0 flex-1 overflow-auto"><div className="sticky top-0 bg-gray-900">Page sticky heading</div><div style={{height:1600}}>Scrollable page content</div><button>Final action</button></div></section>}`;
    },
    configureServer(server) { server.middlewares.use(async (req,res,next)=>{ if(req.url?.split('?')[0]==='/navigation'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body><div id="root"></div><script type="module" src="/navigation-fixture.tsx"></script></body></html>'));}else next();}); }
  }, react()],
  optimizeDeps: { entries: [] },
  resolve: { alias: {'@':resolve(root,'src')} },
  server: { host:'127.0.0.1',port:3107,strictPort:true },
});
await server.listen();
const browser = await chromium.launch({headless:true});
await mkdir(resolve(root,'e2e/artifacts'),{recursive:true});
try {
  const page = await browser.newPage();
  page.on('console',message=>{if(message.type()==='error') console.error(message.text());});
  page.on('pageerror', error=>console.error('BROWSER ERROR',error.message));
  for (const [width,height] of [[320,568],[390,844],[844,390],[768,1024],[1024,768],[1440,900]]) {
    await page.setViewportSize({width,height});
    await page.goto('http://127.0.0.1:3107/navigation#/teams-and-services/members');
    await page.getByRole('region',{name:'Fixture page'}).waitFor();
    const mobile=width<1024;
    const primary=page.getByRole('navigation',{name:'Primary navigation'});
    assert.equal(await primary.isVisible(),mobile);
    assert.equal(await page.getByRole('navigation',{name:'Teams pages'}).isVisible(),mobile);
    if(mobile) {
      assert.equal(await primary.getByRole('link',{name:'Teams',exact:true}).getAttribute('aria-current'),'page');
      await primary.getByRole('link',{name:'Services',exact:true}).click();
      await page.getByRole('navigation',{name:'Services pages'}).getByRole('link',{name:'Service setup',exact:true}).click();
      const strip=page.getByRole('navigation',{name:'Services pages'});
      const selected=await strip.getByRole('link',{name:'Service setup',exact:true}).boundingBox();
      assert(selected.x>=0 && selected.x+selected.width<=width+1);
      const scroller=page.getByRole('region',{name:'Page scroll'});
      await scroller.evaluate(el=>{el.scrollTop=220;});
      await page.waitForTimeout(300);
      const tabs=await strip.boundingBox();
      assert(tabs.y<=1,`collapsed tabs y=${tabs.y}`);
      assert.equal(await scroller.evaluate(el=>el.scrollTop),220);
      const bottom=await primary.boundingBox();
      const content=await scroller.boundingBox();
      assert(content.y+content.height<=bottom.y+1);
      await scroller.evaluate(el=>{el.scrollTop=150;});
      await page.waitForTimeout(300);
      assert((await strip.boundingBox()).y>1);
      await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;});
      await page.waitForTimeout(300);
      const action=await page.getByRole('button',{name:'Final action'}).boundingBox();
      assert(action.y+action.height<=bottom.y+1);
      // Input focus reveals and pins the header while the page scrolls.
      await page.getByRole('textbox',{name:'Page input'}).focus();
      await scroller.evaluate(el=>{el.scrollTop=100;});
      await page.waitForTimeout(300);
      assert((await strip.boundingBox()).y>1);
      await page.getByRole('textbox',{name:'Page input'}).blur();
    } else {
      const links=page.getByRole('navigation',{name:'Teams and Services sections'}).getByRole('link');
      assert.equal(await links.count(),13);
      for(const link of await links.all()) assert(await link.isVisible());
    }
    await page.getByRole('button',{name:'Open menu'}).click();
    const menu=page.getByRole('dialog',{name:'Menu',exact:true});
    for(const label of ['Home','Services','Schedules','Teams','Qualifications']) assert(await menu.getByRole('link',{name:label,exact:true}).isVisible());
    for(const label of ["What's New",'About']) assert(await menu.getByRole('button',{name:label,exact:true}).isVisible());
    assert(await menu.getByRole('button',{name:'Zoom in interface'}).isVisible());
    await page.waitForTimeout(450);
    await page.screenshot({path:resolve(root,`e2e/artifacts/menu-${width}x${height}.png`)});
    await page.keyboard.press('Escape');
    await menu.waitFor({state:'hidden'});
    await page.screenshot({path:resolve(root,`e2e/artifacts/navigation-${width}x${height}.png`)});
    console.log(`PASS ${width}x${height}: navigation, menu, scroll and action clearance`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:3107/navigation#/teams-and-services/members');
  await page.getByRole('button',{name:'Mark dirty'}).click();
  await page.getByRole('button',{name:'Open menu'}).click();
  await page.getByRole('dialog',{name:'Menu',exact:true}).getByRole('link',{name:'Equipment',exact:true}).click();
  await page.getByRole('dialog',{name:'Unsaved changes',exact:true}).getByRole('button',{name:'Discard changes',exact:true}).click();
  await page.getByRole('dialog',{name:'Menu',exact:true}).waitFor({state:'hidden'});
  assert(page.url().endsWith('/microphones'));
  console.log('PASS mobile menu unsaved-change confirmation');

  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:3107/navigation#/teams-and-services/qualifications');
  await page.getByRole('region',{name:'Fixture page'}).waitFor();
  await page.setViewportSize({width:320,height:568});
  await page.waitForTimeout(100);
  const selectedTab = await page.getByRole('navigation',{name:'Teams pages'}).getByRole('link',{name:'Qualifications'}).boundingBox();
  assert(selectedTab.x >= 0 && selectedTab.x + selectedTab.width <= 321);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.getByLabel('Application header').evaluate(el=>getComputedStyle(el).transitionProperty),'none');
  await page.addStyleTag({content:'main { --teams-bottom-navigation-height: calc(4rem + 20px) !important; }'});
  const safeBar = await page.getByRole('navigation',{name:'Primary navigation'}).boundingBox();
  const safeContent = await page.getByRole('region',{name:'Page scroll'}).boundingBox();
  assert.equal(safeBar.height,84);
  assert(safeContent.y+safeContent.height <= safeBar.y+1);
  await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:'Home',exact:true}).click();
  await page.waitForURL(url => url.hash === '#/home');
  await page.getByRole('navigation',{name:'Primary navigation'}).waitFor({state:'hidden'});
  assert.equal(await page.getByRole('navigation',{name:'Primary navigation'}).count(),0);
  await page.goto('http://127.0.0.1:3107/navigation?restricted#/teams-and-services/services');
  await page.getByRole('region',{name:'Fixture page'}).waitFor();
  assert(page.url().endsWith('/schedules'));
  assert.equal(await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:'Services',exact:true}).count(),0);
  console.log('PASS resize, reduced motion, simulated safe-area clearance, Home exit, restricted route');

} finally { await browser.close(); await server.close(); }
