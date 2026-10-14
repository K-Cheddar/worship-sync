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
let releaseFormsPage;
const formsPageGate = new Promise(resolve => { releaseFormsPage = resolve; });
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter, Routes, Route} from 'react-router-dom';
import {ToastProvider} from '/src/context/toastContext';
import TeamsAndServices from '/src/pages/Teams/TeamsAndServices';
import '/src/index.css';
createRoot(document.getElementById('root')).render(<ToastProvider><HashRouter><Routes><Route path="/teams-and-services/*" element={<TeamsAndServices />}/><Route path="/home" element={<div>Home</div>}/></Routes></HashRouter></ToastProvider>);`;
const server = await createServer({
  configFile: false, root,
  plugins: [{ name: 'navigation-fixtures', enforce: 'pre',
    resolveId(id) { if (id === '/navigation-fixture.tsx') return '\0navigation-fixture.tsx'; if (id === 'cookie') return '\0responsive-nav-cookie-fixture'; },
    async load(id) {
      if (id === '\0navigation-fixture.tsx') return (await transformWithEsbuild(fixture, 'fixture.tsx', {loader:'tsx',jsx:'automatic'})).code;
      if (id === '\0responsive-nav-cookie-fixture') return 'export const parse=()=>({}); export const serialize=()=>""; export const parseCookie=parse; export const stringifyCookie=serialize; export const stringifySetCookie=serialize; export const parseSetCookie=()=>[]; export default {parse,serialize};';
      const path = id.replaceAll('\\', '/');
      if (path.endsWith('/Teams/pages/TeamsFormsPage.tsx')) {
        await formsPageGate;
        return;
      }
      if (path.endsWith('/Teams/TeamsPageContext.tsx')) return `import {getAvailableTeamsNavSections} from '/src/pages/Teams/teamsNavSections';
        export const TeamsPageProvider = ({children}) => children;
        const forms = Array.from({length:32},(_,index)=>({formId:'form-'+(index+1),churchId:'fixture-church',name:'Fixture intake form '+(index+1),purpose:'intake',active:false,teamIds:[],startDate:'',endDate:'',responseDeadline:'',availabilityOccurrences:[],availabilityServices:[],enabledFields:[]}));
        const pageData = {services:[],intakeForms:forms,intakeSubmissions:[],intakeRecipients:[],smsEligibilityByMemberId:{},smsDeliveryAttempts:[],members:[],positions:[],schedules:[],teams:[]};
        const templates = {data:[],loaded:true,loading:false,error:null,ensureLoaded:async()=>{},refresh:async()=>{},remove:()=>{},upsert:()=>{}};
        const availableNavSections = getAvailableTeamsNavSections({hasTeamsWorkspaceAccess:true,hasBroadTeamsReadAccess:true,canViewServices:!location.search.includes('restricted')});
        export const useTeamsPage = () => ({loading:false,accessDenied:false,canViewServices:true,canEditServices:true,canEditTeams:true,canManageTeamAvailability:false,canEditTeam:()=>true,serviceTimeZone:'',churchId:'fixture-church',pageData,templates,upsertData:()=>{},removeData:()=>{},refresh:()=>{},availableNavSections});`;
      if (path.endsWith('/context/controllerInfo.tsx')) return `import {createContext} from 'react'; export const ControllerInfoContext=createContext({});`;
      if (path.endsWith('/context/globalInfo.tsx')) return `import {createContext} from 'react'; export const GlobalInfoContext=createContext({loginState:'loggedIn',churchId:'fixture-church',canEditTeams:true,canEditServices:true,userId:'fixture-user'});`;
      if (path.endsWith('/context/toastContext.tsx')) return `import React from 'react'; export const ToastContext=React.createContext({showToast:()=>'',updateToast:()=>{},removeToast:()=>{}}); export const useToast=()=>React.useContext(ToastContext); export const ToastProvider=({children})=>children;`;
      if (path.endsWith('/context/churchServiceTimeZone.tsx')) return `export const useChurchServiceTimeZone=()=>({timeZone:'America/New_York',isConfigured:true,status:'ready'});`;
      if (path.endsWith('/ToolbarElements/UserSection.tsx')) return `export default ()=>null;`;
      if (path.endsWith('/hooks/useAboutChangelogMenu.tsx')) return `export const useAboutChangelogMenu=()=>({aboutChangelogMenuItems:[{text:"What's New",onClick:()=>{}},{text:'About',onClick:()=>{}}],aboutChangelogModals:null,updateReadyVersion:''});`;
      if (/\/Teams\/pages\/Teams\w+Page\.tsx$/.test(path)) return `import React from 'react'; import {useLocation} from 'react-router-dom'; import {useTeamsNavigationGuard} from '/src/pages/Teams/TeamsNavigationGuardContext';
        export default function Page(){const {pathname}=useLocation(); const {setDirtySource}=useTeamsNavigationGuard(); React.useEffect(()=>()=>setDirtySource("fixture",false),[pathname,setDirtySource]); return <section aria-label="Fixture page" className="flex min-h-0 flex-1 flex-col"><h2>{pathname}</h2><button onClick={()=>setDirtySource("fixture",true)}>Mark dirty</button><input aria-label="Page input"/><div className="sticky top-0 bg-gray-900">Page sticky heading</div><div style={{height:1600,flex:'none'}}>Scrollable page content</div><div role="region" aria-label="Nested scroll" style={{height:120,overflow:'auto'}}><div style={{height:700}}>Nested panel content</div></div><button>Final action</button></section>}`;
    },
    configureServer(server) { server.middlewares.use(async (req,res,next)=>{ if(req.url?.split('?')[0]==='/__e2e/release-forms'){releaseFormsPage();res.end('released');return;} if(req.url?.split('?')[0]==='/navigation'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body><div id="root"></div><script type="module" src="/e2e/responsive-navigation-entry.tsx"></script></body></html>'));}else next();}); }
  }, react()],
  optimizeDeps: { entries: ['e2e/responsive-navigation-entry.tsx'] },
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
    const main=await page.locator('main').first().boundingBox();
    const workspace=await page.locator('[data-slot="tabs-content"] > section').boundingBox();
    const expectedBottom=mobile?(await primary.boundingBox()).y:main.y+main.height;
    assert(Math.abs(workspace.y+workspace.height-expectedBottom)<=2,`${width}x${height} workspace bottom ${workspace.y+workspace.height}, available bottom ${expectedBottom}`);
    if(mobile) {
      assert.equal(await primary.getByRole('link').count(),3);
      assert.equal(await primary.getByRole('link',{name:'Home',exact:true}).count(),0);
      assert.equal(await primary.getByRole('link',{name:'Teams',exact:true}).getAttribute('aria-current'),'page');
      const primaryBoxes=await Promise.all((await primary.getByRole('link').all()).map(link=>link.boundingBox()));
      assert(primaryBoxes.every(box=>box && box.height===56));
      assert(Math.max(...primaryBoxes.map(box=>box.width))-Math.min(...primaryBoxes.map(box=>box.width))<1);
      const selectedIcon=primary.getByRole('link',{name:'Teams',exact:true}).locator('span').first();
      const inactiveIcon=primary.getByRole('link',{name:'Services',exact:true}).locator('span').first();
      const selectedStyles=await selectedIcon.evaluate(el=>({background:getComputedStyle(el).backgroundColor,radius:getComputedStyle(el).borderRadius}));
      const inactiveBackground=await inactiveIcon.evaluate(el=>getComputedStyle(el).backgroundColor);
      const selectedLabel=await primary.getByRole('link',{name:'Teams',exact:true}).evaluate(el=>({color:getComputedStyle(el).color,weight:getComputedStyle(el).fontWeight}));
      assert.notEqual(selectedStyles.background,'rgba(0, 0, 0, 0)');
      assert(selectedStyles.radius.includes('9999'));
      assert.equal(inactiveBackground,'rgba(0, 0, 0, 0)');
      assert(selectedLabel.weight==='600' || Number(selectedLabel.weight)>600);
      assert.notEqual(selectedLabel.color,await primary.getByRole('link',{name:'Services',exact:true}).evaluate(el=>getComputedStyle(el).color));
      await primary.getByRole('link',{name:'Services',exact:true}).click();
      await page.getByRole('navigation',{name:'Services pages'}).getByRole('tab',{name:'Service setup',exact:true}).click();
      const strip=page.getByRole('navigation',{name:'Services pages'});
      assert.equal(await strip.locator('svg').count(),0);
      const selected=await strip.getByRole('tab',{name:'Service setup',exact:true}).boundingBox();
      assert.equal(await strip.getByRole('tab',{name:'Service setup',exact:true}).getAttribute('aria-selected'),'true');
      assert(selected.x>=0 && selected.x+selected.width<=width+1);
      assert.equal(await page.getByRole('banner').evaluate(el=>el.classList.contains('max-lg:grid-rows-[0fr]')),false,'horizontal tab navigation collapsed the header');
      const scroller=page.locator('[data-mobile-header-scroll-owner]');
      await scroller.evaluate(el=>{el.scrollTop=220;});
      await page.waitForTimeout(300);
      const tabs=await strip.boundingBox();
      assert(tabs.y<=1,`collapsed tabs y=${tabs.y}`);
      assert.equal(await scroller.evaluate(el=>el.scrollTop),220);
      await page.getByRole('region',{name:'Nested scroll'}).evaluate(el=>{el.scrollTop=80;});
      assert(await page.getByRole('banner').evaluate(el=>el.classList.contains('max-lg:grid-rows-[0fr]')),'nested scrolling changed the header state');
      const bottom=await primary.boundingBox();
      const content=await page.locator('[data-slot="tabs-content"] > section').boundingBox();
      assert(content.y+content.height<=bottom.y+1);
      await scroller.evaluate(el=>{el.scrollTop=150;});
      await page.waitForTimeout(300);
      assert((await strip.boundingBox()).y>1);
      await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;});
      await page.waitForTimeout(300);
      assert(await page.getByRole('banner').evaluate(el=>el.classList.contains('max-lg:grid-rows-[0fr]')),'scrollport resize at the bottom revealed the header again');
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
      assert.equal(await links.count(),12);
      for(const link of await links.all()) assert(await link.isVisible());
      await page.getByRole('button',{name:'Collapse sections'}).click();
      const collapsedSidebar=await page.locator('[data-slot="tabs-content"] > section').boundingBox();
      assert(Math.abs(collapsedSidebar.y+collapsedSidebar.height-(main.y+main.height))<=2,'collapsed desktop sidebar changed workspace height');
      await page.getByRole('button',{name:'Expand sections'}).click();
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
  await page.goto('http://127.0.0.1:3107/navigation#/teams-and-services/schedules');
  const schedulingTabs=page.getByRole('navigation',{name:'Scheduling pages'});
  await schedulingTabs.getByRole('tab',{name:'Forms',exact:true}).click();
  await page.getByRole('status',{name:'Loading forms'}).waitFor();
  const fallbackWorkspace=await page.locator('[data-slot="tabs-content"] > section').boundingBox();
  const fallbackMain=await page.locator('main').first().boundingBox();
  const fallbackBottom=(await page.getByRole('navigation',{name:'Primary navigation'}).boundingBox()).y;
  assert(Math.abs(fallbackWorkspace.y+fallbackWorkspace.height-fallbackBottom)<=2,`lazy fallback bottom ${fallbackWorkspace.y+fallbackWorkspace.height}, available bottom ${fallbackBottom}`);
  assert(Math.abs(fallbackWorkspace.y+fallbackWorkspace.height-(fallbackMain.y+fallbackMain.height-64))<=3);
  await page.request.post('http://127.0.0.1:3107/__e2e/release-forms');
  await page.getByRole('heading',{name:'Intake forms'}).waitFor();
  const formsWorkspace=await page.locator('[data-slot="tabs-content"] > section').boundingBox();
  assert(Math.abs(formsWorkspace.y+formsWorkspace.height-fallbackBottom)<=2);
  const formsList=page.getByTestId('teams-create-panel-list').locator('div.overflow-y-auto').filter({has:page.getByText('Fixture intake form 32',{exact:true})});
  assert.equal(await formsList.count(),1);
  const listMetrics=await formsList.evaluate(el=>({clientHeight:el.clientHeight,scrollHeight:el.scrollHeight}));
  assert(listMetrics.scrollHeight>listMetrics.clientHeight,'real Forms list lost its bounded internal scroll region');
  await formsList.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  const lastForm=await page.getByText('Fixture intake form 32',{exact:true}).boundingBox();
  const listBox=await formsList.boundingBox();
  assert(lastForm.y>=listBox.y-1 && lastForm.y+lastForm.height<=listBox.y+listBox.height+1,'final real Forms row is not reachable inside its list');
  assert.equal(await page.getByRole('banner').evaluate(el=>el.classList.contains('max-lg:grid-rows-[0fr]')),false,'nested real Forms list scroll incorrectly collapsed the main header');
  await schedulingTabs.getByRole('tab',{name:'Messages',exact:true}).click();
  await page.waitForURL(url=>url.hash.endsWith('/teams-and-services/messages'));
  await page.goBack();
  await page.waitForURL(url=>url.hash.endsWith('/teams-and-services/forms'));
  await page.getByRole('heading',{name:'Intake forms'}).waitFor();
  const backWorkspace=await page.locator('[data-slot="tabs-content"] > section').boundingBox();
  assert(Math.abs(backWorkspace.y+backWorkspace.height-fallbackBottom)<=2,'Back restored a stale mobile height constraint');
  await page.goForward();
  await page.waitForURL(url=>url.hash.endsWith('/teams-and-services/messages'));
  await page.getByRole('region',{name:'Fixture page'}).waitFor();
  console.log('PASS production Forms layout, lazy fallback dimensions, nested list reachability, and browser back/forward');

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
  const selectedTab = await page.getByRole('navigation',{name:'Teams pages'}).getByRole('tab',{name:'Qualifications'}).boundingBox();
  assert(selectedTab.x >= 0 && selectedTab.x + selectedTab.width <= 321);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.getByLabel('Application header').evaluate(el=>getComputedStyle(el).transitionProperty),'none');
  await page.addStyleTag({content:'main { --teams-bottom-navigation-height: calc(4rem + 20px) !important; }'});
  const safeBar = await page.getByRole('navigation',{name:'Primary navigation'}).boundingBox();
  const safeContent = await page.locator('[data-slot="tabs-content"] > section').boundingBox();
  assert.equal(safeBar.height,84);
  assert(safeContent.y+safeContent.height <= safeBar.y+1);
  await page.getByRole('button',{name:'Open menu'}).click();
  await page.getByRole('dialog',{name:'Menu',exact:true}).getByRole('link',{name:'Home',exact:true}).click();
  await page.waitForURL(url => url.hash === '#/home');
  assert.equal(await page.getByRole('navigation',{name:'Primary navigation'}).count(),0);
  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:3107/navigation#/teams-and-services/members');
  await page.getByRole('region',{name:'Fixture page'}).waitFor();
  await page.getByRole('button',{name:'Open menu'}).click();
  await page.getByRole('dialog',{name:'Menu',exact:true}).getByRole('link',{name:'Home',exact:true}).click();
  await page.waitForURL(url => url.hash === '#/home');
  await page.goto('http://127.0.0.1:3107/navigation?restricted#/teams-and-services/services');
  await page.getByRole('region',{name:'Fixture page'}).waitFor();
  assert(page.url().endsWith('/schedules'));
  assert.equal(await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:'Services',exact:true}).count(),0);
  console.log('PASS resize, reduced motion, simulated safe-area clearance, Home exit, restricted route');

} finally { await browser.close(); await server.close(); }
