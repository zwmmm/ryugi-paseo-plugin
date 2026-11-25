const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

test("连续输入只自动保存最后一个密码，清空也自动保存", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const load = Module._load;
  const saves = [];
  let settings = { status: "ready", values: { password: "old" }, revision: "1", saving: false };
  const save = async (values, revision) => { saves.push({ values, revision }); return true; };
  const states = [];
  let stateIndex = 0;
  let onStatus;
  let stops = 0;
  let starts = 0;
  const refs = [];
  let effects = [];
  let cleanups = [];
  let refIndex = 0;
  Module._load = function (name, ...args) {
    if (name === "react") return {
      ...load.call(this, name, ...args),
      useState: (initial) => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
      useRef: (initial) => refs[refIndex++] ?? (refs[refIndex - 1] = { current: initial }),
      useEffect: (effect) => effects.push(effect),
    };
    if (name === "@getpaseo/plugin/client/ui") return { SettingsCard: "Card", SettingsInput: "Input", SettingsAction: "Action" };
    if (name === "react-native") return { Text: "Text" };
    if (name === "@getpaseo/plugin/client") return {
      ...load.call(this, name, ...args),
      useRpc: (contract) => async () => {
        if (contract.name === "ryugi.start-tunnel") {
          starts++;
          onStatus({ active: true });
          return { url: "https://fixture.trycloudflare.com/" };
        }
        assert.equal(contract.name, "ryugi.stop-tunnel");
        stops++;
        onStatus({ active: false });
        return { stopped: true };
      },
      useSubscription: (contract, _input, callback) => {
        assert.equal(contract.name, "ryugi.tunnel-status");
        onStatus = callback;
        return { status: "live" };
      },
      useSettings: () => ({ ...settings, save }),
      useTranslation: () => ({ t: (key) => key }),
    };
    return load.call(this, name, ...args);
  };
  let Component;
  try { ({ RemoteAccessSettings: Component } = require("../client/RemoteAccessSettings.tsx")); }
  finally { Module._load = load; }
  const render = () => {
    cleanups.forEach((cleanup) => cleanup?.());
    effects = [];
    refIndex = 0;
    stateIndex = 0;
    const view = Component({ theme: { colors: { foreground: "#000" } } });
    cleanups = effects.map((effect) => effect());
    assert.ok(Array.isArray(view.props.children), "settings shows input and tunnel control");
    const [input, action] = view.props.children;
    assert.equal(input.type, "Input");
    return { ...input.props, action: action.props };
  };
  assert.equal(render().action.disabled, true);
  onStatus({ active: false });
  const initial = settings;
  settings = { ...settings, values: { password: "" } };
  assert.equal(render().action.actionLabel, "remote.start");
  assert.equal(render().action.disabled, true);

  settings = initial;
  assert.equal(render().action.disabled, false);
  await render().action.onPress();
  assert.equal(starts, 1);
  assert.equal(render().action.actionLabel, "remote.stop");
  await render().action.onPress();
  assert.equal(stops, 1);
  assert.equal(render().action.actionLabel, "remote.start");
  assert.equal(render().action.disabled, false);
  assert.deepEqual(saves, []);

  render().onChangeText("n");
  t.mock.timers.tick(100);
  render().onChangeText("new");
  render();
  t.mock.timers.tick(500);
  assert.deepEqual(saves, [{ values: { password: "new" }, revision: "1" }]);

  settings = { ...settings, values: { password: "new" }, revision: "2" };
  render().onChangeText("");
  render();
  t.mock.timers.tick(500);
  assert.deepEqual(saves.at(-1), { values: { password: "" }, revision: "2" });
  settings = { ...settings, values: { password: "" }, revision: "3" };
  render().onChangeText("local draft");
  render();
  settings = { ...settings, values: { password: "other client" }, revision: "4" };
  render().onChangeText("local draft complete");
  render();
  t.mock.timers.tick(500);
  assert.deepEqual(saves.at(-1), { values: { password: "local draft complete" }, revision: "3" });

  settings = { ...settings, saving: true };
  assert.equal(render().disabled, true);
  cleanups.forEach((cleanup) => cleanup?.());
});
