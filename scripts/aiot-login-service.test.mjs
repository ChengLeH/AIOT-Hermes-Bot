import test from "node:test";
import assert from "node:assert/strict";
import { launchAgentLabel, loginAgentPath, loginAgentPlist } from "./aiot-login-service.mjs";

test("login agent starts only AIOT through explicit local arguments", () => {
  const text = loginAgentPlist({ projectRoot: "/opt/AIOT & Bot", node: "/opt/node", wrapper: "/private/with-aiot-env.sh", logPath: "/opt/AIOT & Bot/.aiot/launchd.log" });
  assert.match(text, new RegExp(`<string>${launchAgentLabel}</string>`));
  assert.match(text, /<string>\/private\/with-aiot-env\.sh<\/string>/);
  assert.match(text, /<string>\/opt\/node<\/string>/);
  assert.match(text, /<string>\/opt\/AIOT &amp; Bot\/scripts\/aiot-service\.mjs<\/string>/);
  assert.match(text, /<key>RunAtLoad<\/key>\n\s{2}<true\/>/);
  assert.match(text, /<key>SuccessfulExit<\/key><false\/>/);
  assert.doesNotMatch(text, /AIOT_CONNECTION_KEY|Bearer|sk-/);
});

test("login agent path stays inside the user's LaunchAgents directory", () => {
  assert.equal(loginAgentPath("/Users/demo"), `/Users/demo/Library/LaunchAgents/${launchAgentLabel}.plist`);
});
