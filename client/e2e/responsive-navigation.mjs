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
const planServiceTime = new Date();
planServiceTime.setUTCDate(planServiceTime.getUTCDate()+5);
planServiceTime.setUTCHours(14,0,0,0);
const planServiceDateTime = planServiceTime.toISOString();
const planServiceDate = planServiceDateTime.slice(0,10);
const planKey = `fixture-service@${planServiceDate}`;
const planSections = [{id:'fixture-section',name:'Order of Worship',elements:Array.from({length:28},(_,index)=>({id:`plan-item-${index+1}`,type:'free',title:{blocks:[{type:'paragraph',spans:[{text:`Plan item ${index+1}`}]}]},durationSeconds:120}))}];
let currentServicePlan = {planId:'fixture-plan',churchId:'fixture-church',planKey,serviceId:'fixture-service',date:planServiceDate,name:'Fixture Service',startsAt:planServiceDateTime,timezone:'America/New_York',sections:planSections,publicLive:{mode:'manual',currentElementId:'plan-item-1'},revision:1};
let servicePlanSaveCount = 0;
let releaseFormsPage;
const formsPageGate = new Promise(resolve => { releaseFormsPage = resolve; });
const fixture = `import React from 'react';
import {createRoot} from 'react-dom/client';
import {HashRouter, Routes, Route} from 'react-router-dom';
import {Provider} from 'react-redux';
import store from '/src/store/store';
import {ToastProvider} from '/src/context/toastContext';
import {RehearsalPlaybackProvider} from '/src/components/RehearsalPlayer/RehearsalPlaybackContext';
import {FloatingWindowZIndexProvider} from '/src/components/FloatingWindow/FloatingWindowZIndexContext';
import TeamsAndServices from '/src/pages/Teams/TeamsAndServices';
import '/src/index.css';
createRoot(document.getElementById('root')).render(<Provider store={store}><FloatingWindowZIndexProvider><RehearsalPlaybackProvider><ToastProvider><HashRouter><Routes><Route path="/teams-and-services/*" element={<TeamsAndServices />}/><Route path="/home" element={<div>Home</div>}/></Routes></HashRouter></ToastProvider></RehearsalPlaybackProvider></FloatingWindowZIndexProvider></Provider>);`;
const server = await createServer({
  configFile: false, root,
  plugins: [{ name: 'navigation-fixtures', enforce: 'pre',
    resolveId(id) { if (id === '/navigation-fixture.tsx') return '\0navigation-fixture.tsx'; if (id === 'cookie') return '\0responsive-nav-cookie-fixture'; if (id === 'set-cookie-parser') return '\0responsive-nav-set-cookie-fixture'; },
    async load(id) {
      if (id === '\0navigation-fixture.tsx') return (await transformWithEsbuild(fixture, 'fixture.tsx', {loader:'tsx',jsx:'automatic'})).code;
      if (id === '\0responsive-nav-cookie-fixture') return 'export const parse=()=>({}); export const serialize=()=>""; export const parseCookie=parse; export const stringifyCookie=serialize; export const stringifySetCookie=serialize; export const parseSetCookie=()=>[]; export default {parse,serialize};';
      if (id === '\0responsive-nav-set-cookie-fixture') return 'export const splitCookiesString=(value)=>[value]; export default {splitCookiesString};';
      const path = id.replaceAll('\\', '/');
      if (path.endsWith('/Teams/pages/TeamsFormsPage.tsx')) {
        await formsPageGate;
        return;
      }
      if (path.endsWith('/Teams/pages/TeamsMicrophonesPage.tsx')) return;
      if (path.endsWith('/Teams/pages/TeamsPlansPage.tsx')) return;
      if (path.endsWith('/Teams/pages/TeamsSchedulesPage.tsx')) return;
      if (path.endsWith('/Teams/pages/TeamsMessagesPage.tsx')) return;
      if (path.endsWith('/Teams/pages/TeamsGroupsPage.tsx')) return;
      if (path.endsWith('/Teams/TeamsPageContext.tsx')) return `import {getAvailableTeamsNavSections} from '/src/pages/Teams/teamsNavSections';
        export const TeamsPageProvider = ({children}) => children;
        const forms = Array.from({length:32},(_,index)=>({formId:'form-'+(index+1),churchId:'fixture-church',name:'Fixture intake form '+(index+1),purpose:'intake',active:false,teamIds:[],startDate:'',endDate:'',responseDeadline:'',availabilityOccurrences:[],availabilityServices:[],enabledFields:[]}));
        const planTime='${planServiceDateTime}'; const planService={id:'fixture-service',serviceId:'fixture-service',churchId:'fixture-church',name:'Fixture Service',timerType:'countdown',reccurence:'one_time',dateTimeISO:planTime,positionRequirements:[]};
        const pageData = {services:[planService],intakeForms:forms,intakeSubmissions:[],intakeRecipients:[],smsEligibilityByMemberId:{},smsDeliveryAttempts:[],members:[],positions:[],schedules:[],teams:[],teamRoles:[],qualificationAreas:[],qualificationLevels:[]};
        const templates = {data:[],loaded:true,loading:false,error:null,ensureLoaded:async()=>{},refresh:async()=>{},remove:()=>{},upsert:()=>{}};
        const availableNavSections = getAvailableTeamsNavSections({hasTeamsWorkspaceAccess:true,hasBroadTeamsReadAccess:true,canViewServices:!location.search.includes('restricted')});
        export const useTeamsPage = () => ({loading:false,accessDenied:false,canViewServices:true,canEditServices:true,canEditTeams:true,canEditAnyTeam:true,canManageTeamAvailability:false,canEditTeam:()=>true,editableMemberIds:new Set(),serviceTimeZone:'America/New_York',churchId:'fixture-church',pageData,templates,upsertData:()=>{},removeData:()=>{},refresh:()=>{},availableNavSections,selectedScheduleId:'',scheduleDrafts:{},trackTeamsSave:()=>()=>{},updateSelectedScheduleId:()=>{},updateScheduleDraft:()=>{},flushScheduleDraft:async()=>{},clearScheduleDraft:()=>{},reconcileTeamsProjection:async()=>{},invalidateMemberEditability:()=>{}});`;
      if (path.endsWith('/context/controllerInfo.tsx')) return `import {createContext} from 'react'; export const ControllerInfoContext=createContext(null); export let globalDb=undefined; export let globalBroadcastRef=undefined;`;
      if (path.endsWith('/context/globalInfo.tsx')) return `import {createContext} from 'react'; export const GlobalInfoContext=createContext({loginState:'success',sessionKind:'workstation',user:'Fixture Operator',userEmail:'fixture@example.com',churchName:'Fixture Church',activeInstances:[],hostId:'fixture-host',churchId:'fixture-church',canViewServices:true,canEditTeams:true,canEditServices:true,userId:'fixture-user',churchBranding:{colors:[]}}); export const globalHostId='fixture-host'; export const globalFireDbInfo={};`;
      if (path.endsWith('/context/toastContext.tsx')) return `import React from 'react'; export const ToastContext=React.createContext({showToast:()=>'',updateToast:()=>{},removeToast:()=>{}}); export const useToast=()=>React.useContext(ToastContext); export const ToastProvider=({children})=>children;`;
      if (path.endsWith('/context/churchServiceTimeZone.tsx')) return `export const useChurchServiceTimeZone=()=>({timeZone:'America/New_York',isConfigured:true,status:'ready'});`;
      if (path.endsWith('/chat/ChatContext.tsx')) return `export const useChat=()=>({available:true,unreadCount:2,openChat:()=>{}}); export const ChatProvider=({children})=>children;`;
      if (path.endsWith('/hooks/useAboutChangelogMenu.tsx')) return `export const useAboutChangelogMenu=()=>({aboutChangelogMenuItems:[{text:"What's New",onClick:()=>{}},{text:'About',onClick:()=>{}}],aboutChangelogModals:null,updateReadyVersion:''});`;
      if (/\/Teams\/pages\/Teams\w+Page\.tsx$/.test(path)) return `import React from 'react'; import {useLocation} from 'react-router-dom'; import {useTeamsNavigationGuard} from '/src/pages/Teams/TeamsNavigationGuardContext';
        export default function Page(){const {pathname}=useLocation(); const {setDirtySource}=useTeamsNavigationGuard(); React.useEffect(()=>()=>setDirtySource("fixture",false),[pathname,setDirtySource]); return <section aria-label="Fixture page" className="flex min-h-0 flex-1 flex-col"><h2>{pathname}</h2><button onClick={()=>setDirtySource("fixture",true)}>Mark dirty</button><input aria-label="Page input"/><div className="sticky top-0 bg-gray-900">Page sticky heading</div><div style={{height:1600,flex:'none'}}>Scrollable page content</div><div role="region" aria-label="Nested scroll" style={{height:120,overflow:'auto'}}><div style={{height:700}}>Nested panel content</div></div><button>Final action</button></section>}`;
    },
    configureServer(server) { server.middlewares.use(async (req,res,next)=>{ if(req.url?.split('?')[0]==='/__e2e/release-forms'){releaseFormsPage();res.end('released');return;} if(req.url?.split('?')[0]==='/navigation'){res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body><div id="root"></div><script type="module" src="/navigation-fixture.tsx"></script></body></html>'));}else next();}); }
  }, react()],
  optimizeDeps: { entries: ['src/main.tsx'], esbuildOptions: { absWorkingDir: root } },
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
  await page.route('**/service-plans',async route=>route.fulfill({json:{success:true,servicePlans:[{planKey,serviceId:'fixture-service',date:planServiceDate,name:'Fixture Service',startsAt:planServiceDateTime}]}}));
  await page.route('**/service-plans/**',async route=>{
    if(route.request().method()==='GET') return route.fulfill({json:{success:true,servicePlan:currentServicePlan}});
    if(route.request().method()==='POST'){
      servicePlanSaveCount++;
      currentServicePlan={...currentServicePlan,...route.request().postDataJSON(),revision:currentServicePlan.revision+1};
      return route.fulfill({json:{success:true,servicePlan:currentServicePlan}});
    }
    return route.fulfill({status:405,json:{success:false}});
  });
  await page.route('**/service-plan-templates',async route=>route.fulfill({json:{success:true,templates:[]}}));
  await page.route('**/service-plan-assignment-history',async route=>route.fulfill({json:{success:true,values:[]}}));
  await page.route('**/service-plan-microphones',async route=>route.fulfill({json:{success:true,microphones:[],audiences:[]}}));
  await page.route('**/service-equipment',async route=>route.fulfill({json:{success:true,equipment:[]}}));
  for (const [width,height] of [[320,568],[390,844],[844,390],[768,1024],[1024,768],[1440,900]]) {
    await page.setViewportSize({width,height});
    await page.goto(`http://127.0.0.1:3107/navigation?viewport=${width}x${height}#/teams-and-services/members`);
    await page.getByRole('region',{name:'Fixture page'}).waitFor();
    const mobile=width<1024;
    const primary=page.getByRole('navigation',{name:'Primary navigation'});
    assert.equal(await primary.isVisible(),mobile);
    assert.equal(await page.getByRole('navigation',{name:'Teams pages'}).isVisible(),mobile);
    const main=await page.locator('main').first().boundingBox();
    const workspace=await page.locator('[data-teams-workspace]').boundingBox();
    const expectedBottom=mobile?(await primary.boundingBox()).y:main.y+main.height;
    assert(Math.abs(workspace.y+workspace.height-expectedBottom)<=2,`${width}x${height} workspace bottom ${workspace.y+workspace.height}, available bottom ${expectedBottom}`);
    if(mobile) {
      assert.equal(await primary.getByRole('link').count(),3);
      assert.equal(await primary.getByRole('link',{name:'Home',exact:true}).count(),0);
      assert.equal(await primary.getByRole('link',{name:'Teams',exact:true}).getAttribute('aria-current'),'page');
      const primaryBoxes=await Promise.all((await primary.getByRole('link').all()).map(link=>link.boundingBox()));
      assert(primaryBoxes.every(box=>box && box.height===56), `${width}x${height} primary item boxes ${JSON.stringify(primaryBoxes)}`);
      assert(Math.max(...primaryBoxes.map(box=>box.width))-Math.min(...primaryBoxes.map(box=>box.width))<1);
      const selectedIcon=primary.getByRole('link',{name:'Teams',exact:true}).locator('span').first();
      const inactiveIcon=primary.getByRole('link',{name:'Services',exact:true}).locator('span').first();
      const selectedStyles=await selectedIcon.evaluate(el=>({background:getComputedStyle(el).backgroundColor,radius:getComputedStyle(el).borderRadius}));
      const inactiveBackground=await inactiveIcon.evaluate(el=>getComputedStyle(el).backgroundColor);
      const selectedLabel=await primary.getByRole('link',{name:'Teams',exact:true}).evaluate(el=>({color:getComputedStyle(el).color,weight:getComputedStyle(el).fontWeight}));
      const selectedPill=await selectedIcon.boundingBox();
      assert(Math.abs(selectedPill.width-60)<1);
      assert(Math.abs(selectedPill.height-30)<1);
      assert.notEqual(selectedStyles.background,'rgba(0, 0, 0, 0)');
      assert.notEqual(selectedStyles.radius, '0px');
      assert.equal(inactiveBackground,'rgba(0, 0, 0, 0)');
      assert(selectedLabel.weight==='600' || Number(selectedLabel.weight)>600);
      assert.equal(selectedLabel.color,'rgb(255, 255, 255)');
      assert.notEqual(selectedLabel.color,await primary.getByRole('link',{name:'Services',exact:true}).evaluate(el=>getComputedStyle(el).color));
      await primary.getByRole('link',{name:'Services',exact:true}).click();
      await page.getByRole('navigation',{name:'Services pages'}).getByRole('tab',{name:'Service setup',exact:true}).click();
      await page.getByRole('region',{name:'Fixture page'}).getByText('/teams-and-services/service-setup',{exact:true}).waitFor();
      await page.reload();
      await page.waitForFunction(()=>location.hash.includes('/teams-and-services/service-setup')&&document.querySelector('[data-mobile-header-scroll-owner]')?.scrollHeight>1000&&document.querySelector('[aria-label="Fixture page"] h2')?.textContent==='/teams-and-services/service-setup');
      const strip=page.getByRole('navigation',{name:'Services pages'});
      assert.equal(await strip.locator('svg').count(),0);
      await page.waitForFunction(()=>{
        const viewport=document.querySelector('nav[aria-label="Services pages"]')?.getBoundingClientRect();
        const tab=document.querySelector('nav[aria-label="Services pages"] [role="tab"][aria-selected="true"]')?.getBoundingClientRect();
        return Boolean(viewport&&tab&&tab.left>=viewport.left&&tab.right<=viewport.right);
      });
      const selected=await strip.getByRole('tab',{name:'Service setup',exact:true}).boundingBox();
      assert.equal(await strip.getByRole('tab',{name:'Service setup',exact:true}).getAttribute('aria-selected'),'true');
      assert(selected.x>=0 && selected.x+selected.width<=width+1);
      const toolbar=page.locator('[data-app-toolbar]');
      const toolbarBefore=await toolbar.boundingBox();
      const routeTabsBefore=await strip.boundingBox();
      const toolbarStyles=await toolbar.evaluate(el=>({className:el.className,height:getComputedStyle(el).height,minHeight:getComputedStyle(el).minHeight,padding:getComputedStyle(el).padding,rowHeight:getComputedStyle(el).gridTemplateRows}));
      assert(toolbarBefore&&Math.abs(toolbarBefore.y)<1&&Math.abs(toolbarBefore.height-48)<1,`compact toolbar geometry ${JSON.stringify({toolbarBefore,toolbarStyles})}`);
      assert(routeTabsBefore&&Math.abs(routeTabsBefore.y-(toolbarBefore.y+toolbarBefore.height))<1,`route tabs are not directly below the app toolbar: ${JSON.stringify({toolbarBefore,routeTabsBefore})}`);
      assert.equal(await page.locator('[data-app-toolbar] h1').isVisible(),false,'mobile app toolbar still shows the page title and icon');
      const menuButton=page.getByRole('button',{name:'Open menu'});
      const accountButton=page.getByRole('button',{name:/Account: Fixture Operator/});
      assert((await menuButton.boundingBox()).height>=44,`Menu touch target is shorter than 44px: ${JSON.stringify(await menuButton.boundingBox())}`);
      assert((await accountButton.boundingBox()).height>=44,`Account touch target is shorter than 44px: ${JSON.stringify(await accountButton.boundingBox())}`);
      assert(await accountButton.getByText('Synced',{exact:true}).isVisible(),'compact toolbar sync status is missing');
      assert.match(await accountButton.getAttribute('aria-label'),/2 unread team chat messages/,'compact toolbar notification count is missing');
      if(width===320){
        await accountButton.click();
        await page.getByText('Account',{exact:true}).waitFor();
        await page.getByRole('button',{name:/Open team chat.*2 unread/i}).waitFor();
        await page.getByRole('button',{name:'Close popover'}).click();
      }
      const scroller=page.locator('[data-mobile-header-scroll-owner]');
      await scroller.evaluate(el=>{el.scrollTop=220;});
      await page.waitForTimeout(300);
      const scrolledToolbar=await toolbar.boundingBox();
      const scrolledTabs=await strip.boundingBox();
      assert(scrolledToolbar&&Math.abs(scrolledToolbar.y-toolbarBefore.y)<1&&Math.abs(scrolledToolbar.height-48)<1,`workspace scrolling moved or resized the compact toolbar: ${JSON.stringify(scrolledToolbar)}`);
      assert(scrolledTabs&&Math.abs(scrolledTabs.y-routeTabsBefore.y)<1,`workspace scrolling moved the route tabs: ${JSON.stringify(scrolledTabs)}`);
      assert.equal(await scroller.evaluate(el=>el.scrollTop),220);
      await page.getByRole('region',{name:'Nested scroll'}).evaluate(el=>{el.scrollTop=80;});
      assert(Math.abs((await toolbar.boundingBox()).y-toolbarBefore.y)<1,'nested scrolling moved the compact toolbar');
      const bottom=await primary.boundingBox();
      const content=await page.locator('[data-teams-workspace]').boundingBox();
      assert(content.y+content.height<=bottom.y+1);
      await scroller.evaluate(el=>{el.scrollTop=150;});
      await page.waitForTimeout(300);
      assert(Math.abs((await strip.boundingBox()).y-routeTabsBefore.y)<1,'scrolling back moved the route tabs');
      await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;});
      await page.waitForTimeout(100);
      assert(Math.abs((await toolbar.boundingBox()).y-toolbarBefore.y)<1,'scrolling to the bottom moved the compact toolbar');
      const action=await page.getByRole('button',{name:'Final action'}).boundingBox();
      assert(action.y+action.height<=bottom.y+1);
      // Input focus does not change the stable toolbar or route-tab positions.
      await page.getByRole('textbox',{name:'Page input'}).focus();
      await scroller.evaluate(el=>{el.scrollTop=100;});
      await page.waitForTimeout(300);
      assert(Math.abs((await strip.boundingBox()).y-routeTabsBefore.y)<1);
      assert(Math.abs((await toolbar.boundingBox()).y-toolbarBefore.y)<1);
      await page.getByRole('textbox',{name:'Page input'}).blur();
    } else {
      assert(await page.locator('[data-app-toolbar] h1').isVisible(),`desktop app title is hidden at ${width}px`);
      assert.equal(await page.locator('[data-app-toolbar] h1').innerText(),'Teams and Services');
      const links=page.getByRole('navigation',{name:'Teams and Services sections'}).getByRole('link');
      assert.equal(await links.count(),12);
      for(const link of await links.all()) assert(await link.isVisible());
      await page.getByRole('button',{name:'Collapse sections'}).click();
      const collapsedSidebar=await page.locator('[data-teams-workspace]').boundingBox();
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
  for(const [route,ready] of [
    ['schedules',()=>page.getByRole('heading',{name:'Schedules',exact:true}).waitFor()],
    ['messages',()=>page.getByRole('heading',{name:'Volunteer messages',exact:true}).waitFor()],
    ['groups',()=>page.getByTestId('teams-create-panel-list').waitFor()],
  ]){
    for(const width of [320,375,390,768,1024,1440]){
      await page.setViewportSize({width,height:width===320?568:844});
      await page.goto(`http://127.0.0.1:3107/navigation#/teams-and-services/${route}`);
      await ready();
      const toolbar=await page.locator('[data-app-toolbar]').boundingBox();
      assert(toolbar&&Math.abs(toolbar.y)<1,`${route} toolbar is not pinned in normal flow at ${width}px: ${JSON.stringify(toolbar)}`);
      if(width<1024){
        const tabs=await page.getByRole('navigation',{name:route==='groups'?'Teams pages':route==='schedules'||route==='messages'?'Scheduling pages':'Teams pages'}).boundingBox();
        assert(Math.abs(toolbar.height-48)<1&&tabs&&Math.abs(tabs.y-(toolbar.y+toolbar.height))<1,`${route} mobile chrome overlaps at ${width}px: ${JSON.stringify({toolbar,tabs})}`);
        assert.equal(await page.locator('[data-app-toolbar] h1').isVisible(),false,`${route} mobile toolbar shows a redundant page title`);
      }else{
        assert(await page.locator('[data-app-toolbar] h1').isVisible(),`${route} desktop toolbar title is hidden at ${width}px`);
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`${route} has horizontal overflow at ${width}px`);
    }
  }
  console.log('PASS real Schedules, Messages, and Teams management pages across mobile, tablet, and desktop widths');
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:3107/navigation#/teams-and-services/schedules');
  const schedulingTabs=page.getByRole('navigation',{name:'Scheduling pages'});
  await schedulingTabs.getByRole('tab',{name:'Forms',exact:true}).click();
  await page.getByRole('status',{name:'Loading forms'}).waitFor();
  const fallbackWorkspace=await page.locator('[data-teams-workspace]').boundingBox();
  const fallbackMain=await page.locator('main').first().boundingBox();
  const fallbackBottom=(await page.getByRole('navigation',{name:'Primary navigation'}).boundingBox()).y;
  assert(Math.abs(fallbackWorkspace.y+fallbackWorkspace.height-fallbackBottom)<=2,`lazy fallback bottom ${fallbackWorkspace.y+fallbackWorkspace.height}, available bottom ${fallbackBottom}`);
  assert(Math.abs(fallbackWorkspace.y+fallbackWorkspace.height-(fallbackMain.y+fallbackMain.height-57))<=3);
  await page.request.post('http://127.0.0.1:3107/__e2e/release-forms');
  await page.getByRole('heading',{name:'Intake forms'}).waitFor();
  const formsWorkspace=await page.locator('[data-teams-workspace]').boundingBox();
  assert(Math.abs(formsWorkspace.y+formsWorkspace.height-fallbackBottom)<=2);
  const formsList=page.getByTestId('teams-create-panel-list').locator('div.overflow-y-auto').filter({has:page.getByText('Fixture intake form 32',{exact:true})});
  assert.equal(await formsList.count(),1);
  const listMetrics=await formsList.evaluate(el=>({clientHeight:el.clientHeight,scrollHeight:el.scrollHeight}));
  assert(listMetrics.scrollHeight>listMetrics.clientHeight,'real Forms list lost its bounded internal scroll region');
  await formsList.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  const lastForm=await page.getByText('Fixture intake form 32',{exact:true}).boundingBox();
  const listBox=await formsList.boundingBox();
  assert(lastForm.y>=listBox.y-1 && lastForm.y+lastForm.height<=listBox.y+listBox.height+1,'final real Forms row is not reachable inside its list');
  assert.equal(await page.locator('header[aria-label="Application header"]').evaluate(el=>el.classList.contains('max-lg:grid-rows-[0fr]')),false,'nested real Forms list scroll incorrectly collapsed the main header');
  await schedulingTabs.getByRole('tab',{name:'Messages',exact:true}).click();
  await page.waitForURL(url=>url.hash.endsWith('/teams-and-services/messages'));
  await page.goBack();
  await page.waitForURL(url=>url.hash.endsWith('/teams-and-services/forms'));
  await page.getByRole('heading',{name:'Intake forms'}).waitFor();
  const backWorkspace=await page.locator('[data-teams-workspace]').boundingBox();
  assert(Math.abs(backWorkspace.y+backWorkspace.height-fallbackBottom)<=2,'Back restored a stale mobile height constraint');
  await page.goForward();
  await page.waitForURL(url=>url.hash.endsWith('/teams-and-services/messages'));
  await page.getByRole('heading',{name:'Volunteer messages',exact:true}).waitFor();
  console.log('PASS production Forms layout, lazy fallback dimensions, nested list reachability, and browser back/forward');

  for(const width of [320,375,390,768,1024,1440]){
    await page.setViewportSize({width,height:width===320?568:844});
    await page.goto('http://127.0.0.1:3107/navigation#/teams-and-services/forms');
    await page.getByRole('heading',{name:'Intake forms'}).waitFor();
    const toolbar=await page.locator('[data-app-toolbar]').boundingBox();
    assert(toolbar&&Math.abs(toolbar.y)<1,`Forms toolbar position at ${width}px: ${JSON.stringify(toolbar)}`);
    if(width<1024){
      const tabs=await page.getByRole('navigation',{name:'Scheduling pages'}).boundingBox();
      assert(Math.abs(toolbar.height-48)<1&&tabs&&Math.abs(tabs.y-(toolbar.y+toolbar.height))<1,`Forms mobile chrome overlaps at ${width}px: ${JSON.stringify({toolbar,tabs})}`);
      assert.equal(await page.locator('[data-app-toolbar] h1').isVisible(),false);
    }else assert(await page.locator('[data-app-toolbar] h1').isVisible());
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`Forms has horizontal overflow at ${width}px`);
  }
  console.log('PASS real Forms page at 320, 375, 390, 768, 1024, and 1440px');

  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:3107/navigation#/teams-and-services/members');
  await page.getByRole('button',{name:'Mark dirty'}).click();
  await page.getByRole('button',{name:'Open menu'}).click();
  await page.getByRole('dialog',{name:'Menu',exact:true}).getByRole('link',{name:'Equipment',exact:true}).click();
  const unsavedDialog=page.getByRole('dialog',{name:'Unsaved changes',exact:true});
  const unsavedDialogBox=await unsavedDialog.boundingBox();
  assert(unsavedDialogBox&&unsavedDialogBox.x>=0&&unsavedDialogBox.y>=0&&unsavedDialogBox.x+unsavedDialogBox.width<=391&&unsavedDialogBox.y+unsavedDialogBox.height<=845,`unsaved-changes dialog is clipped: ${JSON.stringify(unsavedDialogBox)}`);
  await unsavedDialog.getByRole('button',{name:'Discard changes',exact:true}).click();
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
  assert.equal(await page.getByLabel('Application header').evaluate(el=>el.className.includes('transition-')),false);
  assert.equal((await page.locator('[data-app-toolbar]').boundingBox()).height,48);
  await page.addStyleTag({content:'main { --teams-bottom-navigation-height: calc(57px + 20px) !important; }'});
  const safeBar = await page.getByRole('navigation',{name:'Primary navigation'}).boundingBox();
  const safeContent = await page.locator('[data-teams-workspace]').boundingBox();
  assert.equal(safeBar.height,77);
  assert(safeContent.y+safeContent.height <= safeBar.y+1);
  await page.getByRole('button',{name:'Open menu'}).click();
  await page.getByRole('dialog',{name:'Menu',exact:true}).getByRole('link',{name:'Home',exact:true}).click();
  await page.waitForURL(url => url.hash === '#/home');
  assert.equal(await page.getByRole('navigation',{name:'Primary navigation'}).count(),0);
  await page.setViewportSize({width:1440,height:900});
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:3107/navigation#/teams-and-services/members');
  await page.locator('[data-teams-workspace]').waitFor();
  await page.getByRole('button',{name:'Open menu'}).click();
  await page.getByRole('dialog',{name:'Menu',exact:true}).getByRole('link',{name:'Home',exact:true}).click();
  await page.waitForURL(url => url.hash === '#/home');
  await page.goto('http://127.0.0.1:3107/navigation?restricted#/teams-and-services/services');
  await page.getByRole('heading',{name:'Schedules',exact:true}).waitFor();
  assert(page.url().endsWith('/schedules'));
  assert.equal(await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:'Services',exact:true}).count(),0);
  console.log('PASS resize, reduced motion, simulated safe-area clearance, Home exit, restricted route');

  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:3107/navigation#/teams-and-services/services');
  const openFixturePlan=page.getByRole('button',{name:/Open plan for/}).first();
  await openFixturePlan.waitFor();
  await openFixturePlan.click();
  const planList=page.locator('#service-plan-list');
  await planList.waitFor();
  const beforePlanScroll=await planList.evaluate(el=>({clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop}));
  assert(beforePlanScroll.scrollHeight>beforePlanScroll.clientHeight+200,`real plan fixture needs an overflowing running order: ${JSON.stringify(beforePlanScroll)}`);
  await planList.evaluate(el=>{el.dataset.e2eIdentity='stable-plan-list';});
  const planBox=await planList.boundingBox();
  await page.mouse.move(planBox.x+planBox.width/2,planBox.y+planBox.height/2);
  await page.mouse.wheel(0,500);
  await page.getByRole('button',{name:'Show service details'}).waitFor();
  await page.waitForTimeout(300);
  const planHeaderState=await page.evaluate(()=>({toolbar:document.querySelector('[data-app-toolbar]')?.getBoundingClientRect().toJSON(),routeTabs:document.querySelector('nav[aria-label="Services pages"]')?.getBoundingClientRect().toJSON(),scrollTop:document.querySelector('#service-plan-list')?.scrollTop,scrollHeight:document.querySelector('#service-plan-list')?.scrollHeight,clientHeight:document.querySelector('#service-plan-list')?.clientHeight,owner:document.querySelector('#service-plan-list')?.getAttribute('data-mobile-header-scroll-owner')}));
  assert(planHeaderState.scrollTop>0,`service-plan running-order did not scroll: ${JSON.stringify(planHeaderState)}`);
  assert(Math.abs(planHeaderState.toolbar.y)<1&&Math.abs(planHeaderState.toolbar.height-48)<1,`service-plan scrolling moved the compact toolbar: ${JSON.stringify(planHeaderState)}`);
  assert(Math.abs(planHeaderState.routeTabs.y-(planHeaderState.toolbar.y+planHeaderState.toolbar.height))<1,`service-plan scrolling moved route tabs from below the toolbar: ${JSON.stringify(planHeaderState)}`);
  await page.waitForTimeout(250);
  const compactPlanScroll=await planList.evaluate(el=>({clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop,identity:el.dataset.e2eIdentity}));
  assert(compactPlanScroll.clientHeight>=beforePlanScroll.clientHeight+16,`compacting details did not give the running order more space: ${JSON.stringify({beforePlanScroll,compactPlanScroll})}`);
  assert(compactPlanScroll.scrollTop>0,'manual service-plan scrolling did not move the stable running-order list');
  await page.getByRole('button',{name:'Show service details'}).click();
  assert(Math.abs((await page.locator('[data-app-toolbar]').boundingBox()).y)<1,'showing service details moved the compact toolbar');
  assert.equal(await planList.getAttribute('data-e2e-identity'),'stable-plan-list');
  assert(Math.abs(await planList.evaluate(el=>el.scrollTop)-compactPlanScroll.scrollTop)<=1,'revealing service details repositioned the running order');
  await page.getByRole('tab',{name:'Rehearse'}).click();
  assert.equal(await planList.getAttribute('data-e2e-identity'),'stable-plan-list','switching plan views remounted the running-order list');
  await page.getByRole('tab',{name:'Plan / Order of service'}).click();
  await page.mouse.move(planBox.x+planBox.width/2,planBox.y+planBox.height/2);
  await page.mouse.wheel(0,500);
  await page.getByRole('button',{name:'Follow live'}).waitFor();
  await page.getByRole('button',{name:'Follow live'}).click();
  await page.waitForFunction(()=>document.querySelector('#service-plan-list')?.scrollTop<100);
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  const savePlanResponse=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.includes('/service-plans/'));
  await page.getByRole('textbox',{name:'Section name'}).fill('Updated Order of Worship');
  const savedPlanResponse=await savePlanResponse;
  assert.equal(savedPlanResponse.status(),200);
  assert.equal(servicePlanSaveCount,1,'editing the running order did not use the existing service-plan save path');
  console.log(`PASS real Service Plans page: compact/restore details, stable list identity and scroll, Follow live, autosave; list ${beforePlanScroll.clientHeight}px -> ${compactPlanScroll.clientHeight}px`);

  for(const width of [320,375,390,768,1024,1440]){
    await page.setViewportSize({width,height:width===320?568:844});
    await page.goto(`http://127.0.0.1:3107/navigation?service-layout=${width}#/teams-and-services/services`);
    const openPlan=page.getByRole('button',{name:/Open plan for/}).first();
    await openPlan.waitFor();
    const toolbarBefore=await page.locator('[data-app-toolbar]').boundingBox();
    assert(toolbarBefore&&Math.abs(toolbarBefore.y)<1,`Services toolbar position at ${width}px: ${JSON.stringify(toolbarBefore)}`);
    if(width<1024){
      const tabs=await page.getByRole('navigation',{name:'Services pages'}).boundingBox();
      assert(Math.abs(toolbarBefore.height-48)<1&&tabs&&Math.abs(tabs.y-(toolbarBefore.y+toolbarBefore.height))<1,`Services mobile chrome overlaps at ${width}px: ${JSON.stringify({toolbarBefore,tabs})}`);
      assert.equal(await page.locator('[data-app-toolbar] h1').isVisible(),false);
    }else assert(await page.locator('[data-app-toolbar] h1').isVisible());
    await openPlan.click();
    const planList=page.locator('#service-plan-list');
    await planList.waitFor();
    const toolbarAfter=await page.locator('[data-app-toolbar]').boundingBox();
    assert(toolbarAfter&&Math.abs(toolbarAfter.y)<1,`open Service Plan toolbar position at ${width}px: ${JSON.stringify(toolbarAfter)}`);
    if(width<1024){
      const tabs=await page.getByRole('navigation',{name:'Services pages'}).boundingBox();
      assert(Math.abs(toolbarAfter.height-48)<1&&tabs&&Math.abs(tabs.y-(toolbarAfter.y+toolbarAfter.height))<1,`Service Plan mobile chrome overlaps at ${width}px: ${JSON.stringify({toolbarAfter,tabs})}`);
    }
    await page.getByRole('tab',{name:'Rehearse'}).waitFor();
  }
  console.log('PASS real Services list and open Service Plan at 320, 375, 390, 768, 1024, and 1440px');

  let equipmentMicrophones = Array.from({length:36},(_,index)=>({id:`mic-${index+1}`,name:`Mic ${index+1}`,type:'handheld',color:'#22d3ee'}));
  let equipmentIems = Array.from({length:36},(_,index)=>({id:`iem-${index+1}`,category:'iem',name:`IEM ${index+1}`,subtype:'wireless-beltpack',color:'#22d3ee'}));
  let microphoneSaveCount = 0;
  let iemSaveCount = 0;
  let rejectNextIemSave = true;
  await page.route('**/service-plan-microphones',async route=>{
    if(route.request().method()==='GET') return route.fulfill({json:{success:true,microphones:equipmentMicrophones,audiences:[]}});
    microphoneSaveCount++;
    const body=route.request().postDataJSON();
    equipmentMicrophones=body.microphones;
    return route.fulfill({json:{success:true,microphones:equipmentMicrophones,audiences:body.audiences||[]}});
  });
  await page.route('**/service-equipment',async route=>{
    if(route.request().method()==='GET') return route.fulfill({json:{success:true,equipment:equipmentIems}});
    iemSaveCount++;
    if(rejectNextIemSave){rejectNextIemSave=false;return route.fulfill({status:500,json:{message:'Fixture IEM save failure'}});}
    const body=route.request().postDataJSON();
    equipmentIems=body.equipment;
    return route.fulfill({json:{success:true,equipment:equipmentIems}});
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:3107/navigation#/teams-and-services/microphones');
  const equipmentCategories=page.getByRole('tablist',{name:'Equipment categories'});
  await equipmentCategories.waitFor();
  const iemTab=equipmentCategories.getByRole('tab',{name:'In-Ear Monitors (IEMs)'});
  const checkMobileEquipmentGeometry=async(category,mode)=>{
    const routeTabs=await page.getByRole('navigation',{name:'Services pages'}).boundingBox();
    const categoryBox=await page.locator('[data-equipment-category-tabs]').boundingBox();
    const actions=page.locator(`[data-equipment-actions="${category}"]`);
    const actionsBox=await actions.boundingBox();
    const scrollport=page.locator(`[data-equipment-scrollport="${category}"]`);
    const scrollBox=await scrollport.boundingBox();
    const bottomBox=await page.getByRole('navigation',{name:'Primary navigation'}).boundingBox();
    const headerPosition=await actions.evaluate(el=>getComputedStyle(el).position);
    assert(routeTabs&&categoryBox&&actionsBox&&scrollBox&&bottomBox,`${category} ${mode} layout is missing a visible layer`);
    const scrollMetrics=await scrollport.evaluate(el=>({clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop}));
    assert(categoryBox.y>=routeTabs.y+routeTabs.height-1,`${category} tabs overlap route navigation: ${JSON.stringify({categoryBox,routeTabs})}`);
    assert(actionsBox.y>=categoryBox.y+categoryBox.height-1,`${category} actions overlap category tabs: ${JSON.stringify({categoryBox,actionsBox})}`);
    assert(scrollBox.y>=actionsBox.y+actionsBox.height-1,`${category} list viewport begins above its action row: ${JSON.stringify({actionsBox,scrollBox})}`);
    assert(scrollBox.y+scrollBox.height<=bottomBox.y+1,`${category} list viewport is covered by bottom navigation: ${JSON.stringify({scrollBox,bottomBox})}`);
    assert.equal(headerPosition,'static',`${category} mobile actions should be in the flex layout, not another sticky layer`);
    assert.equal(await equipmentCategories.getByRole('tab',{name:category==='iems'?'In-Ear Monitors (IEMs)':'Microphones'}).getAttribute('data-state'),'active');
    assert(scrollMetrics.scrollHeight>scrollMetrics.clientHeight,`${category} ${mode} list is not an independently bounded scrollport: ${JSON.stringify(scrollMetrics)}`);
    if(category==='iems'&&mode==='edit'){
      const firstIemRow=page.locator('[data-equipment-editor-row]').filter({has:page.locator('#iem-name-iem-1')});
      const [colorBox,nameBox,typeBox,removeBox]=await Promise.all([
        firstIemRow.locator('[data-iem-color-control]').boundingBox(),
        firstIemRow.locator('#iem-name-iem-1').boundingBox(),
        firstIemRow.getByRole('combobox').boundingBox(),
        firstIemRow.getByRole('button',{name:'Remove IEM 1'}).boundingBox(),
      ]);
      assert(colorBox&&nameBox&&typeBox&&removeBox,`IEM editor controls are missing at mobile width ${await page.evaluate(()=>innerWidth)}`);
      const colorCenterY=colorBox.y+colorBox.height/2;
      const removeCenterY=removeBox.y+removeBox.height/2;
      assert(Math.abs(colorCenterY-removeCenterY)<=1&&colorBox.x<removeBox.x&&nameBox.y>colorBox.y&&typeBox.y>nameBox.y,`mobile IEM controls lost their color/delete first row and stacked fields: ${JSON.stringify({colorBox,nameBox,typeBox,removeBox})}`);
    }
    const prefix=category==='iems'?'IEM':'Mic';
    const finalRow=page.locator(`[aria-label="${prefix} 36"]`).last();
    await scrollport.evaluate(el=>{el.scrollTop=Math.floor((el.scrollHeight-el.clientHeight)/2);});
    await page.waitForTimeout(30);
    const middleActions=await actions.boundingBox();
    const middleCategory=await page.locator('[data-equipment-category-tabs]').boundingBox();
    const middleRoute=await page.getByRole('navigation',{name:'Services pages'}).boundingBox();
    const middleScroll=await scrollport.boundingBox();
    assert(middleActions&&middleCategory&&middleRoute&&middleScroll&&middleCategory.y>=middleRoute.y+middleRoute.height-1&&middleActions.y>=middleCategory.y+middleCategory.height-1&&middleScroll.y>=middleActions.y+middleActions.height-1,`${category} layers overlapped during scrolling: ${JSON.stringify({middleRoute,middleCategory,middleActions,middleScroll})}`);
    await scrollport.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await page.waitForTimeout(30);
    const finalRowBox=await finalRow.boundingBox();
    const finalScrollBox=await scrollport.boundingBox();
    const viewportWidth=await page.evaluate(()=>window.innerWidth);
    assert(finalRowBox&&finalScrollBox&&finalRowBox.y>=finalScrollBox.y-1&&finalRowBox.y+finalRowBox.height<=finalScrollBox.y+finalScrollBox.height+1,`${category} final item is not fully reachable: ${JSON.stringify({finalRowBox,finalScrollBox})}`);
    assert(finalRowBox.y+finalRowBox.height<=bottomBox.y+1,`${category} final item is covered by bottom navigation`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`${category} ${mode} view has horizontal overflow at ${viewportWidth}px`);
    await scrollport.evaluate(el=>{el.scrollTop=0;});
  };
  for(const width of [320,375,390,768]){
    await page.setViewportSize({width,height:844});
    for(const category of ['microphones','iems']){
      const tab=category==='iems'?iemTab:equipmentCategories.getByRole('tab',{name:'Microphones'});
      await tab.click();
      const prefix=category==='iems'?'IEM':'Mic';
      await page.getByText(`${prefix} 36`,{exact:true}).waitFor();
      await checkMobileEquipmentGeometry(category,'view');
      await page.getByRole('button',{name:category==='iems'?'Edit IEMs':'Edit microphones'}).click();
      await checkMobileEquipmentGeometry(category,'edit');
      await page.locator(`[data-equipment-actions="${category}"]`).getByRole('button',{name:'Close'}).click();
    }
  }
  await page.setViewportSize({width:390,height:844});
  await iemTab.click();
  await page.getByRole('button',{name:'Edit IEMs'}).click();
  const iemToolbar=page.getByRole('button',{name:'Add IEM'});
  await iemToolbar.waitFor();
  const equipmentScroll=page.locator('[data-equipment-scrollport="iems"]');
  await equipmentScroll.evaluate(el=>{el.scrollTop=0;});
  const equipmentToolbarBefore=await page.locator('[data-app-toolbar]').boundingBox();
  const equipmentRouteBefore=await page.getByRole('navigation',{name:'Services pages'}).boundingBox();
  const equipmentCategoryBefore=await page.locator('[data-equipment-category-tabs]').boundingBox();
  let scrollBox=await equipmentScroll.boundingBox();
  await page.mouse.move(scrollBox.x+scrollBox.width/2,scrollBox.y+scrollBox.height/2);
  await page.mouse.wheel(0,140);
  await page.waitForTimeout(300);
  const equipmentScrolled=await equipmentScroll.evaluate(el=>({scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));
  assert(equipmentScrolled.scrollTop>0,`Equipment list did not scroll: ${JSON.stringify(equipmentScrolled)}`);
  const equipmentToolbarAfter=await page.locator('[data-app-toolbar]').boundingBox();
  const equipmentRouteAfter=await page.getByRole('navigation',{name:'Services pages'}).boundingBox();
  const equipmentCategoryAfter=await page.locator('[data-equipment-category-tabs]').boundingBox();
  assert(equipmentToolbarBefore&&equipmentToolbarAfter&&Math.abs(equipmentToolbarAfter.y-equipmentToolbarBefore.y)<1&&Math.abs(equipmentToolbarAfter.height-48)<1,`Equipment scrolling moved the compact toolbar: ${JSON.stringify({equipmentToolbarBefore,equipmentToolbarAfter})}`);
  assert(equipmentRouteBefore&&equipmentRouteAfter&&Math.abs(equipmentRouteAfter.y-equipmentRouteBefore.y)<1,`Equipment scrolling moved route tabs: ${JSON.stringify({equipmentRouteBefore,equipmentRouteAfter})}`);
  assert(equipmentCategoryBefore&&equipmentCategoryAfter&&Math.abs(equipmentCategoryAfter.y-equipmentCategoryBefore.y)<1,`Equipment scrolling moved its category tabs: ${JSON.stringify({equipmentCategoryBefore,equipmentCategoryAfter})}`);
  scrollBox=await equipmentScroll.boundingBox();
  await page.mouse.move(scrollBox.x+scrollBox.width/2,scrollBox.y+scrollBox.height/2);
  await page.mouse.wheel(0,-240);
  await page.waitForTimeout(300);
  assert(Math.abs((await page.locator('[data-app-toolbar]').boundingBox()).y-equipmentToolbarBefore.y)<1,`scrolling back moved the compact toolbar`);
  await page.setViewportSize({width:320,height:420});
  const lastIemName=page.locator('#iem-name-iem-36');
  await lastIemName.focus();
  await lastIemName.scrollIntoViewIfNeeded();
  const shortViewportActions=await page.locator('[data-equipment-actions="iems"]').boundingBox();
  const shortViewportBottom=await page.getByRole('navigation',{name:'Primary navigation'}).boundingBox();
  const shortViewportInput=await lastIemName.boundingBox();
  assert(shortViewportActions&&shortViewportBottom&&shortViewportInput&&shortViewportActions.y+shortViewportActions.height<=shortViewportBottom.y,`editing actions are obscured in a reduced-height keyboard viewport: ${JSON.stringify({shortViewportActions,shortViewportBottom})}`);
  assert(shortViewportInput.y>=0&&shortViewportInput.y+shortViewportInput.height<=shortViewportBottom.y,`focused equipment field is not reachable above the bottom bar: ${JSON.stringify({shortViewportInput,shortViewportBottom})}`);
  await page.locator('[data-equipment-actions="iems"]').getByRole('button',{name:'Close'}).click();
  for(const width of [1024,1440]){
    await page.setViewportSize({width,height:900});
    const desktopPanel=page.locator('[data-equipment-panel="iems"]');
    const desktopPanelBox=await desktopPanel.boundingBox();
    const desktopCategory=await page.locator('[data-equipment-category-tabs]').boundingBox();
    const desktopActions=page.locator('[data-equipment-actions="iems"]');
    const desktopActionsBox=await desktopActions.boundingBox();
    assert(desktopPanelBox&&desktopCategory&&desktopActionsBox,`Equipment desktop layout is missing a layer at ${width}px`);
    assert(desktopPanelBox.y>=desktopCategory.y+desktopCategory.height-1,`desktop panel overlaps Equipment categories at ${width}px: ${JSON.stringify({desktopPanelBox,desktopCategory})}`);
    assert(desktopActionsBox.y>=desktopCategory.y+desktopCategory.height-1,`desktop actions overlap Equipment categories at ${width}px`);
    assert.equal(await desktopActions.evaluate(el=>getComputedStyle(el).position),'sticky',`desktop action header should stay visible inside its panel at ${width}px`);
    const opaqueBackground=await desktopActions.evaluate(el=>getComputedStyle(el).backgroundColor);
    assert(!opaqueBackground.endsWith(', 0)')&&!opaqueBackground.includes('/ 0)'),`desktop action header is transparent at ${width}px: ${opaqueBackground}`);
    await desktopPanel.evaluate(el=>{el.scrollTop=el.scrollHeight;});
    const pinnedActions=await desktopActions.boundingBox();
    const finalDesktopRow=await page.locator('[aria-label="IEM 36"]').last().boundingBox();
    const scrolledPanel=await desktopPanel.boundingBox();
    assert(pinnedActions&&scrolledPanel&&Math.abs(pinnedActions.y-scrolledPanel.y)<=2,`desktop IEM actions did not stay at the panel top: ${JSON.stringify({pinnedActions,scrolledPanel})}`);
    assert(finalDesktopRow&&finalDesktopRow.y>=scrolledPanel.y-1&&finalDesktopRow.y+finalDesktopRow.height<=scrolledPanel.y+scrolledPanel.height+1,`desktop final IEM is unreachable: ${JSON.stringify({finalDesktopRow,scrolledPanel})}`);
    assert.equal(await page.getByRole('navigation',{name:'Primary navigation'}).isVisible(),false,`mobile bottom navigation is visible at desktop width ${width}`);
    await desktopPanel.evaluate(el=>{el.scrollTop=0;});
    await page.getByRole('button',{name:'Edit IEMs'}).click();
    await page.getByRole('button',{name:/Save IEMs|Saved IEMs/}).waitFor();
    await page.locator('#iem-name-iem-36').waitFor();
    if(width===1440){
      const firstIemRow=page.locator('[data-equipment-editor-row]').filter({has:page.locator('#iem-name-iem-1')});
      const controls=[
        ['Color/icon',firstIemRow.locator('[data-iem-color-control]')],
        ['Name',firstIemRow.locator('#iem-name-iem-1')],
        ['Type',firstIemRow.getByRole('combobox')],
        ['Delete',firstIemRow.getByRole('button',{name:'Remove IEM 1'})],
      ];
      const boxes=await Promise.all(controls.map(([,control])=>control.boundingBox()));
      assert(boxes.every(Boolean),`desktop IEM editor controls are missing: ${JSON.stringify(boxes)}`);
      const centers=boxes.map(box=>({x:box.x+box.width/2,y:box.y+box.height/2}));
      assert(centers.every((center,index)=>index===0||centers[index-1].x<center.x)&&centers.every(center=>Math.abs(center.y-centers[0].y)<=2),`desktop IEM controls are not aligned left-to-right as Color/icon, Name, Type, Delete: ${JSON.stringify({controls:controls.map(([name])=>name),boxes,centers})}`);
      console.log('PASS desktop IEM editor control positions at 1440px: Color/icon, Name, Type, Delete');
    }
    const desktopEditActions=await page.locator('[data-equipment-actions="iems"]').boundingBox();
    const desktopEditToolbar=await page.locator('[data-app-toolbar]').boundingBox();
    assert(desktopEditActions&&desktopEditToolbar&&desktopEditActions.y>=desktopCategory.y+desktopCategory.height-1,`desktop Equipment edit actions overlap category tabs at ${width}px`);
    assert(Math.abs(desktopEditToolbar.y)<1,`desktop Equipment editing moved the application toolbar at ${width}px`);
    await page.locator('[data-equipment-actions="iems"]').getByRole('button',{name:'Close'}).click();
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Edit IEMs'}).click();
  await iemToolbar.click();
  const addedIem=page.locator('input[id^="iem-name-"]').last();
  await addedIem.waitFor();
  await page.waitForFunction(id=>document.activeElement?.id===id,await addedIem.getAttribute('id'));
  await page.waitForTimeout(250);
  assert.equal(await addedIem.evaluate(el=>document.activeElement===el),true,'Add IEM did not focus the new item');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'Equipment editor has horizontal overflow');
  await lastIemName.fill('IEM 36 draft');
  await iemTab.click();
  await equipmentCategories.getByRole('tab',{name:'Microphones'}).click();
  await page.getByRole('button',{name:'Edit microphones'}).click();
  const lastMicName=page.locator('#microphone-name-mic-36');
  await lastMicName.fill('Mic 36 saved');
  await page.getByRole('button',{name:'Save microphones'}).click();
  await page.getByRole('button',{name:'Saved microphones'}).waitFor();
  assert.equal(microphoneSaveCount,1);
  assert.equal(iemSaveCount,0,'saving microphones also wrote the IEM catalog');
  await equipmentCategories.getByRole('tab',{name:'In-Ear Monitors (IEMs)'}).click();
  assert.equal(await page.locator('#iem-name-iem-36').inputValue(),'IEM 36 draft','IEM draft was lost while switching categories');
  const failedIemSave=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.includes('/service-equipment'));
  await page.getByRole('button',{name:'Save IEMs'}).click();
  assert.equal((await failedIemSave).status(),500);
  assert.equal(await page.locator('#iem-name-iem-36').inputValue(),'IEM 36 draft','failed IEM save discarded its draft');
  assert.equal(await page.getByRole('button',{name:'Save IEMs'}).isEnabled(),true,'failed IEM save did not remain retryable');
  await page.getByRole('button',{name:'Save IEMs'}).click();
  await page.getByRole('button',{name:'Saved IEMs'}).waitFor();
  assert.equal(iemSaveCount,2,'IEM save retry did not remain independent');
  const lastIemRow=page.locator('[data-equipment-editor-row]').filter({has:page.locator('#iem-name-iem-36')});
  await lastIemRow.getByRole('button',{name:'#22d3ee'}).click();
  const colorPopover=page.locator('[data-radix-popper-content-wrapper]').last();
  await colorPopover.waitFor();
  const colorPopoverBox=await colorPopover.boundingBox();
  assert(colorPopoverBox&&colorPopoverBox.x>=0&&colorPopoverBox.y>=0&&colorPopoverBox.x+colorPopoverBox.width<=391&&colorPopoverBox.y+colorPopoverBox.height<=845,`color picker is clipped: ${JSON.stringify(colorPopoverBox)}`);
  await colorPopover.getByRole('button',{name:'Close popover'}).click();
  await lastIemRow.getByRole('combobox').click();
  const subtypeList=page.getByRole('listbox').last();
  await subtypeList.waitFor();
  const subtypeListBox=await subtypeList.boundingBox();
  assert(subtypeListBox&&subtypeListBox.x>=0&&subtypeListBox.y>=0&&subtypeListBox.x+subtypeListBox.width<=391&&subtypeListBox.y+subtypeListBox.height<=845,`IEM subtype menu is clipped: ${JSON.stringify(subtypeListBox)}`);
  await page.keyboard.press('Escape');
  await page.unroute('**/service-plan-microphones');
  await page.unroute('**/service-equipment');
  console.log('PASS real Equipment page: large catalogs, sticky actions, focused add, retained drafts, independent save/retry, and unclipped color/type popovers');

} finally { await browser.close(); await server.close(); }
