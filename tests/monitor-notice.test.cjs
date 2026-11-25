const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const { PluginTranslationRuntime } = require('@getpaseo/plugin/client/host');
const load = Module._load;
let locale = 'zh-CN';
const runtime = new PluginTranslationRuntime({ getLocale: () => locale, subscribe: () => () => {} });
let state = [];
let cursor = 0;
Module._load = function(name, ...args) {
  if (name === '@getpaseo/plugin/client/ui') return { Icon: 'Icon' };
  if (name === '@getpaseo/plugin/client') return { ...load.call(this, name, ...args), useTranslation: (messages) => ({ locale, t: (key, ...options) => runtime.t(messages, key, ...options) }) };
  if (name === 'react-native') return { Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: (styles) => styles } };
  if (name === 'react') return { ...load.call(this, name, ...args), useState: (initial) => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (update) => { state[index] = typeof update === 'function' ? update(state[index]) : update; }]; } };
  return load.call(this, name, ...args);
};
let parseMonitorNotice, noticeSummary, MonitorNotice;
try { ({ parseMonitorNotice, noticeSummary, MonitorNotice } = require('../client/MonitorNotice.tsx')); } finally { Module._load = load; }

const { messages } = require('../client/messages.ts');

function notice(type, extra = {}) {
  return `Ryugi monitor: ${type}${extra.withdrawn ? '（用户已撤回提交）' : ''}\n通知\n${JSON.stringify({ type, project: '/private/project', artifact: 'document/test', ...extra })}\n完整 CLI 参数和处理要求`;
}

test('摘要区分评论、方案、问答与撤回，保留完整通知', () => {
  for (const [type, extra, summary] of [
    ['ryugi-comments', { unread: 2 }, '收到 2 条新评论'],
    ['ryugi-comments', {}, '收到新评论'],
    ['ryugi-choices', {}, '已提交方案选择'],
    ['ryugi-choices', { withdrawn: true }, '已撤回方案选择'],
    ['ryugi-answers', { questions: 4 }, '已提交 4 个问题的回答'],
    ['ryugi-answers', {}, '已提交回答'],
    ['ryugi-answers', { withdrawn: true }, '已撤回回答'],
  ]) {
    const text = notice(type, extra);
    const data = parseMonitorNotice(text);
    assert.equal(noticeSummary(data, (key, ...args) => runtime.t(messages, key, ...args)), `Ryugi · ${summary}`);
    assert.equal(data.text, text);
  }
  for (const text of ['普通消息', 'Ryugi monitor: ryugi-answers\n通知\n{broken', 'Ryugi monitor: ryugi-answers\n通知\nnull']) {
    assert.equal(parseMonitorNotice(text), undefined);
  }
});

test('无计数的方案通知可作为 Paseo 时间线数据传递', () => {
  const text = notice('ryugi-choices', { round: 'round-one', groups: 1, submit: 'submission-id' });
  const data = parseMonitorNotice(text);
  assert.deepEqual(data, { type: 'ryugi-choices', withdrawn: false, text });
});

test('通知默认折叠，悬停显示箭头，点击展开原文并可再次收起', () => {
  state = [];
  locale = 'zh-CN';
  const data = parseMonitorNotice(notice('ryugi-answers', { questions: 4 }));
  const props = { item: { data }, theme: { colors: { surface1: '#222', border: '#333', foreground: '#fff', foregroundMuted: '#aaa' } } };
  const render = () => { cursor = 0; return MonitorNotice(props); };
  const button = (tree) => tree.props.children[0].props.children;
  const icon = (tree) => button(tree).props.children[0].props.children.props.children;
  let tree = render();
  assert.equal(tree.props.children[1], false);
  assert.equal(button(tree).props.accessibilityState.expanded, false);
  assert.equal(icon(tree).props.name, 'Wrench');
  tree.props.onPointerEnter();
  tree = render();
  assert.equal(icon(tree).props.name, 'ChevronRight');
  tree.props.onPointerLeave();
  button(tree).props.onPress();
  tree = render();
  const details = tree.props.children[1].props.children.props.children;
  assert.equal(details.props.children, data.text);
  assert.equal(details.props.selectable, true);
  assert.equal(button(tree).props.accessibilityState.expanded, true);
  assert.equal(icon(tree).props.name, 'ChevronRight');
  locale = 'en';
  tree = render();
  assert.equal(button(tree).props.accessibilityLabel, 'Ryugi · Answers to 4 questions submitted');
  assert.equal(button(tree).props.accessibilityState.expanded, true);
  assert.equal(tree.props.children[1].props.children.props.children.props.children, data.text);
  button(tree).props.onPress();
  assert.equal(render().props.children[1], false);
});

test('英文复数与未支持语言回退，摘要数据不绑定语言', () => {
  const t = (key, ...args) => runtime.t(messages, key, ...args);
  locale = 'en';
  const one = parseMonitorNotice(notice('ryugi-comments', { unread: 1 }));
  const many = parseMonitorNotice(notice('ryugi-comments', { unread: 2 }));
  assert.equal(noticeSummary(one, t), 'Ryugi · 1 new comment received');
  assert.equal(noticeSummary(many, t), 'Ryugi · 2 new comments received');
  assert.equal(noticeSummary(parseMonitorNotice(notice('ryugi-answers', { questions: 1 })), t), 'Ryugi · Answer to 1 question submitted');
  locale = 'fr';
  assert.equal(noticeSummary(many, t), 'Ryugi · 2 new comments received');
  locale = 'zh-CN';
  assert.equal(noticeSummary(many, t), 'Ryugi · 收到 2 条新评论');
});
