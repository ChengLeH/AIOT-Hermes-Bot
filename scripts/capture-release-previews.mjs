import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const baseUrl=process.env.AIOT_PREVIEW_URL||"http://127.0.0.1:8888/";
const output=resolve(process.cwd(),"docs/images"); mkdirSync(output,{recursive:true});
const now=Date.now();
const profiles=[
  {name:"orion",display_name:"Orion",available:true,canonical_session_id:"demo-orion"},
  {name:"studio",display_name:"Studio",available:true,canonical_session_id:"demo-studio"},
  {name:"sage",display_name:"Sage",available:true,canonical_session_id:"demo-sage"},
];
const capabilities={attachments:true,attachment_uploads:true,attachment_downloads:true,durable_events:true,completion_events:true,dynamic_completions:true,interrupts:true};
const catalog={profiles,transport:"native-bot",capabilities};
const tasks=[
  {id:"task-approval",title:"Export release data",status:"waiting_approval",mode:"independent",botId:"hp:orion",profile:"orion",createdAt:now-22_000,updatedAt:now-2_000},
  {id:"task-review",title:"Review release notes",status:"running",mode:"fork",contextCount:7,botId:"hp:orion",profile:"orion",createdAt:now-46_000,updatedAt:now-4_000},
  {id:"task-index",title:"Build a document index",status:"completed",mode:"independent",botId:"hp:orion",profile:"orion",createdAt:now-210_000,updatedAt:now-32_000,terminalAt:new Date(now-32_000).toISOString()},
];
function localizedTasks(locale){
  if(locale==="en") return tasks;
  return tasks.map(task=>({...task,title:task.id==="task-approval"?"匯出版本資料":task.id==="task-review"?"檢查版本說明":"建立文件索引"}));
}
const details={
  "task-approval":{...tasks[0],messages:[
    {id:"u0",role:"user",content:"Export the release summary as JSON."},
    {id:"a0",role:"assistant",content:"The export is ready to run after your approval."},
  ],pendingApproval:{kind:"approval",description:"Allow this task to create the release export file.",command:"node scripts/export-release.mjs --format json",receivedAt:new Date(now-2_000).toISOString(),timeoutSeconds:600,expiresAt:new Date(now+598_000).toISOString(),choices:["once","deny"]}},
  "task-review":{...tasks[1],queuedTurns:[{id:"queue-1",text:"After that, list the two most important deployment checks.",createdAt:new Date(now-8_000).toISOString()}],messages:[
    {id:"u1",role:"user",content:"Review the v0.2.3 release notes using the recent Bot context."},
    {id:"a1",role:"assistant",content:"I am checking the installation steps and security notes now.\n\n```ts\nconst release = \"v0.2.3\";\nconst checks = [\"npm test\", \"npm run build\"];\n```"},
  ],contextSnapshot:{available:true,messages:[
    {role:"user",text:"Can you check whether the public setup is clear for a new Linux user?"},
    {role:"assistant",text:"I will compare the launcher, security notes, and first-run flow."},
    {role:"user",text:"Keep the existing Hermes service unchanged and use its official Session API."},
    {role:"assistant",text:"Understood. I will treat the existing Hermes instance as the trust boundary."},
    {role:"user",text:"Also verify that private keys never appear in the repository or screenshots."},
    {role:"assistant",text:"I will run the public-source scan and review the generated preview fixtures."},
    {role:"user",text:"Summarize the result in the release notes."},
  ]}},
  "task-index":{...tasks[2],messages:[
    {id:"u2",role:"user",content:"Create a small index from the attached release notes."},
    {id:"a2",role:"assistant",content:"The index is ready. You can preview or download the result.",attachments:[{id:"artifact-demo",taskId:"task-index",name:"release-index.txt",mime:"text/plain",size:128}]},
  ]},
};
const events=[
  {seq:1,profile:"orion",conversation:"demo-orion",kind:"user_message",payload:{message_id:"m1",text:"Prepare the v0.2.3 release."}},
  {seq:2,profile:"orion",conversation:"demo-orion",kind:"message",payload:{message_id:"m2",text:"I will verify the current build, tests, and deployment notes."}},
];

function storedState(locale){return JSON.stringify({state:{
  onboarded:true,locale,view:"roster",activeBotId:null,composerDrafts:{},messages:[],approvals:[],
  bots:profiles.map((p,index)=>({id:`hp:${p.name}`,name:p.display_name,title:p.display_name,bio:p.name,swatch:["steel","moss","clay"][index],pinned:index===0,createdAt:now-index*1000,profile:p.name,available:true,conversation:p.canonical_session_id})),
  connection:{origin:"https://preview.invalid",lastProbe:{ok:true,at:now,transport:"native-bot",profiles,capabilities}},
},version:0})}

const jobs=[
  {id:"job-digest",name:"Morning project digest",prompt:"Summarize completed work and open approvals.",schedule_display:"Every day · 09:00",enabled:true,next_run_at:new Date(now+36_000_000).toISOString(),latest_execution:null},
  {id:"job-backup",name:"Weekly archive check",prompt:"Verify the encrypted task archive.",schedule_display:"Every Friday · 18:00",enabled:false,next_run_at:null,latest_execution:null},
];

async function createPage(browser,locale){
  const pageTasks=localizedTasks(locale);
  const pageDetails={
    "task-approval":{...details["task-approval"],title:pageTasks[0].title,messages:[
      {id:"u0",role:"user",content:locale==="en"?"Export the release summary as JSON.":"把版本摘要匯出為 JSON。"},
      {id:"a0",role:"assistant",content:locale==="en"?"The export is ready to run after your approval.":"匯出流程已準備好，等你批准後執行。"},
    ],pendingApproval:{...details["task-approval"].pendingApproval,description:locale==="en"?"Allow this task to create the release export file.":"允許這個任務建立版本匯出檔。"}},
    "task-review":{...details["task-review"],title:pageTasks[1].title,messages:[
      {id:"u1",role:"user",content:locale==="en"?"Review the v0.2.3 release notes using the recent Bot context.":"使用最近的 Bot 脈絡檢查 v0.2.3 版本說明。"},
      {id:"a1",role:"assistant",content:locale==="en"?details["task-review"].messages[1].content:"我正在檢查安裝步驟與安全性說明。\n\n```ts\nconst release = \"v0.2.3\";\nconst checks = [\"npm test\", \"npm run build\"];\n```"},
    ],queuedTurns:[{id:"queue-1",text:locale==="en"?"After that, list the two most important deployment checks.":"完成後，列出兩項最重要的部署檢查。",createdAt:new Date(now-8_000).toISOString()}],contextSnapshot:{available:true,messages:details["task-review"].contextSnapshot.messages.map((message,index)=>locale==="en"?message:{...message,text:["可以檢查公開安裝流程對新的 Linux 使用者是否清楚嗎？","我會比對啟動程式、安全說明與第一次設定流程。","保留現有 Hermes 服務，並使用官方 Session API。","了解；我會把現有 Hermes 實例視為信任邊界。","也請確認私人金鑰不會出現在儲存庫或預覽圖。","我會執行公開來源掃描並檢查預覽用的虛構資料。","把結果整理進版本說明。"][index]})}},
    "task-index":{...details["task-index"],title:pageTasks[2].title,messages:[
      {id:"u2",role:"user",content:locale==="en"?"Create a small index from the attached release notes.":"從附加的版本說明建立一份精簡索引。"},
      {id:"a2",role:"assistant",content:locale==="en"?"The index is ready. You can preview or download the result.":"索引已經完成，可以直接預覽或下載結果。",attachments:[{id:"artifact-demo",taskId:"task-index",name:"release-index.txt",mime:"text/plain",size:128}]},
    ]},
  };
  pageTasks[1]={...pageTasks[1],contextSnapshot:pageDetails["task-review"].contextSnapshot};
  const context=await browser.newContext({viewport:{width:390,height:844},colorScheme:"dark",locale:locale==="en"?"en-US":"zh-TW"});
  await context.addInitScript(({state})=>{
    localStorage.setItem("hermes-bot-desk-v4",state);
    localStorage.setItem("hermes.gate.password:https://preview.invalid","preview-only-key-not-a-secret");
  },{state:storedState(locale)});
  await context.route("**/*",async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==="/api/bot/sessions/status")return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({authenticated:true,dashboardOrigin:"https://dashboard.preview.invalid"})});
    if(url.pathname==="/api/bot/sessions/list")return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({tasks:pageTasks})});
    if(url.pathname==="/api/bot/sessions/detail")return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({task:pageDetails[url.searchParams.get("id")]||pageDetails["task-review"]})});
    if(url.pathname==="/api/bot/sessions/artifact")return route.fulfill({status:200,contentType:"text/plain",headers:{"content-disposition":"attachment; filename=release-index.txt"},body:"AIOT v0.2.3 release index\n"});
    if(url.pathname==="/__aiot/hermes"){
      const path=url.searchParams.get("path")||"";
      if(path.startsWith("/api/bot/profiles"))return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(catalog)});
      if(path.startsWith("/api/bot/events"))return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({events,durable:true})});
      if(path.startsWith("/api/bot/native/jobs"))return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({jobs:locale==="en"?jobs:jobs.map((job,index)=>({...job,name:index===0?"每日專案摘要":"每週封存檢查",prompt:index===0?"整理已完成工作與待批准項目。":"檢查加密任務封存是否正常。",schedule_display:index===0?"每天 · 09:00":"每週五 · 18:00"}))})});
      return route.fulfill({status:200,contentType:"application/json",body:"{}"});
    }
    return route.continue();
  });
  const page=await context.newPage(); await page.goto(baseUrl,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(3500);
  return {context,page};
}

const browser=await chromium.launch({channel:"chrome",headless:true});
for(const locale of ["en","zh-Hant"]){
  let {context,page}=await createPage(browser,locale);
  await page.screenshot({path:resolve(output,`v023-roster-${locale}.png`)});
  await page.getByRole("button",{name:/^Orion/}).first().click(); await page.waitForTimeout(500);
  await page.screenshot({path:resolve(output,`v023-chat-${locale}.png`)});
  await page.getByRole("button",{name:locale==="en"?"Tasks":"任務管理"}).click(); await page.waitForTimeout(500);
  await page.screenshot({path:resolve(output,`v023-queue-${locale}.png`)});
  await page.getByText(locale==="en"?"Review release notes":"檢查版本說明",{exact:true}).click(); await page.waitForTimeout(1500);
  await page.screenshot({path:resolve(output,`v023-fork-${locale}.png`)});
  await page.getByRole("button",{name:locale==="en"?"View 7 fork context messages":"查看 7 則分岔脈絡"}).click(); await page.waitForTimeout(350);
  await page.screenshot({path:resolve(output,`v023-context-${locale}.png`)});
  await context.close();

  ({context,page}=await createPage(browser,locale));
  await page.getByRole("button",{name:/^Orion/}).first().click(); await page.waitForTimeout(500);
  await page.getByRole("button",{name:locale==="en"?"Schedules":"排程工作"}).click(); await page.waitForTimeout(500);
  await page.screenshot({path:resolve(output,`v023-schedules-${locale}.png`)});
  await context.close();

  ({context,page}=await createPage(browser,locale));
  await page.getByRole("button",{name:/^Orion/}).first().click(); await page.waitForTimeout(500);
  await page.getByRole("button",{name:locale==="en"?"Tasks":"任務管理"}).click(); await page.waitForTimeout(500);
  await page.getByText(locale==="en"?"Export release data":"匯出版本資料",{exact:true}).click(); await page.waitForTimeout(2600);
  await page.screenshot({path:resolve(output,`v023-approval-${locale}.png`)});
  await context.close();

  ({context,page}=await createPage(browser,locale));
  await page.getByRole("button",{name:/^Orion/}).first().click(); await page.waitForTimeout(500);
  await page.getByRole("button",{name:locale==="en"?"Tasks":"任務管理"}).click(); await page.waitForTimeout(500);
  await page.getByText(locale==="en"?"Build a document index":"建立文件索引",{exact:true}).click(); await page.waitForTimeout(2600);
  await page.screenshot({path:resolve(output,`v023-files-${locale}.png`)});
  await context.close();
}
await browser.close(); console.log(output);
