import test from "node:test";
import assert from "node:assert/strict";
import {requestTaskDeepLink,takeTaskDeepLink,subscribeTaskDeepLink} from "./task-deep-link.ts";
test("notification task navigation is single-use and cannot cross Bot conversation scope",()=>{
 const id="11111111-2222-4333-8444-555555555555";let calls=0;
 const off=subscribeTaskDeepLink(()=>calls++);
 assert.equal(requestTaskDeepLink("a","c",id),true);
 assert.equal(calls,1);assert.equal(takeTaskDeepLink("b","c"),null);assert.equal(takeTaskDeepLink("a","other"),null);
 assert.deepEqual(takeTaskDeepLink("a","c"),{taskId:id});assert.equal(takeTaskDeepLink("a","c"),null);
 assert.equal(requestTaskDeepLink("a","c","https://evil.test"),false);off();
});
