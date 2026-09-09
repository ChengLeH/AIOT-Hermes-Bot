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
    {id:"u1",role:"user",content:"Review the v0.2.2 release notes using the recent Bot context."},
    {id:"a1",role:"assistant",content:"I am checking the installation steps and security notes now.\n\n```ts\nconst release = \"v0.2.2\";\nconst checks = [\"npm test\", \"npm run build\"];\n```"},
  ]},
  "task-index":{...tasks[2],messages:[
    {id:"u2",role:"user",content:"Create a small index from the attached release notes."},
    {id:"a2",role:"assistant",content:"The index is ready. You can preview or download the result.",attachments:[{id:"artifact-demo",taskId:"task-index",name:"release-index.txt",mime:"text/plain",size:128}]},
  ]},
};
const events=[
  {seq:1,profile:"orion",conversation:"demo-orion",kind:"user_message",payload:{message_id:"m1",text:"Prepare the v0.2.2 release."}},
  {seq:2,profile:"orion",conversation:"demo-orion",kind:"message",payload:{message_id:"m2",text:"I will verify the current build, tests, and deployment notes."}},
];

function storedState(locale){return JSON.stringify({state:{
  onboarded:true,locale,view:"roster",activeBotId:null,composerDrafts:{},messages:[],approvals:[],
  bots:profiles.map((p,index)=>({id:`hp:${p.name}`,name:p.display_name,title:p.display_name,bio:p.name,swatch:["steel","moss","clay"][index],pinned:index===0,createdAt:now-index*1000,profile:p.name,available:true,conversation:p.canonical_session_id})),
  connection:{origin:"https://preview.invalid",lastProbe:{ok:true,at:now,transport:"native-bot",profiles,capabilities}},
},version:0})}

async function createPage(browser,locale){
  const pageTasks=localizedTasks(locale);
  const pageDetails={
    "task-approval":{...details["task-approval"],title:pageTasks[0].title,messages:[
      {id:"u0",role:"user",content:locale==="en"?"Export the release summary as JSON.":"把版本摘要匯出為 JSON。"},
      {id:"a0",role:"assistant",content:locale==="en"?"The export is ready to run after your approval.":"匯出流程已準備好，等你批准後執行。"},
    ],pendingApproval:{...details["task-approval"].pendingApproval,description:locale==="en"?"Allow this task to create the release export file.":"允許這個任務建立版本匯出檔。"}},
    "task-review":{...details["task-review"],title:pageTasks[1].title,messages:[
      {id:"u1",role:"user",content:locale==="en"?"Review the v0.2.2 release notes using the recent Bot context.":"使用最近的 Bot 脈絡檢查 v0.2.2 版本說明。"},
      {id:"a1",role:"assistant",content:locale==="en"?details["task-review"].messages[1].content:"我正在檢查安裝步驟與安全性說明。\n\n```ts\nconst release = \"v0.2.2\";\nconst checks = [\"npm test\", \"npm run build\"];\n```"},
    ],queuedTurns:[{id:"queue-1",text:locale==="en"?"After that, list the two most important deployment checks.":"完成後，列出兩項最重要的部署檢查。",createdAt:new Date(now-8_000).toISOString()}]},
    "task-index":{...details["task-index"],title:pageTasks[2].title,messages:[
      {id:"u2",role:"user",content:locale==="en"?"Create a small index from the attached release notes.":"從附加的版本說明建立一份精簡索引。"},
      {id:"a2",role:"assistant",content:locale==="en"?"The index is ready. You can preview or download the result.":"索引已經完成，可以直接預覽或下載結果。",attachments:[{id:"artifact-demo",taskId:"task-index",name:"release-index.txt",mime:"text/plain",size:128}]},
    ]},
  };
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
    if(url.pathname==="/api/bot/sessions/artifact")return route.fulfill({status:200,contentType:"text/plain",headers:{"content-disposition":"attachment; filename=release-index.txt"},body:"AIOT v0.2.2 release index\n"});
    if(url.pathname==="/__aiot/hermes"){
      const path=url.searchParams.get("path")||"";
      if(path.startsWith("/api/bot/profiles"))return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(catalog)});
      if(path.startsWith("/api/bot/events"))return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({events,durable:true})});
      return route.fulfill({status:200,contentType:"application/json",body:"{}"});
    }
    return route.continue();
  });
  const page=await context.newPage(); await page.goto(baseUrl,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(1200);
  await page.getByText("Orion",{exact:true}).click(); await page.waitForTimeout(500);
  await page.getByRole("button",{name:locale==="en"?"Tasks":"任務管理"}).click(); await page.waitForTimeout(500);
  return {context,page};
}

const browser=await chromium.launch({channel:"chrome",headless:true});
for(const locale of ["en","zh-Hant"]){
  const {context,page}=await createPage(browser,locale);
  await page.screenshot({path:resolve(output,`v022-queue-${locale}.png`)});
  await page.getByText(locale==="en"?"Export release data":"匯出版本資料",{exact:true}).click(); await page.waitForTimeout(2600);
  await page.screenshot({path:resolve(output,`v022-approval-${locale}.png`)});
  await page.getByRole("button",{name:locale==="en"?"Tasks":"任務管理"}).click(); await page.waitForTimeout(300);
  await page.getByText(locale==="en"?"Build a document index":"建立文件索引",{exact:true}).click(); await page.waitForTimeout(2600);
  await page.screenshot({path:resolve(output,`v022-files-${locale}.png`)});
  await context.close();
}
await browser.close(); console.log(output);
