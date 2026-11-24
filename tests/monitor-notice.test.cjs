const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const load = Module._load;
let state = [];
let cursor = 0;
Module._load = function(name, ...args) {
  if (name === '@getpaseo/plugin/client/ui') return { Icon: 'Icon' };
  if (name === 'react-native') return { Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View' };
  if (name === 'react') return { ...load.call(this, name, ...args), useState: (initial) => { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (update) => { state[index] = typeof update === 'function' ? update(state[index]) : update; }]; } };
  return load.call(this, name, ...args);
};
let parseMonitorNotice, MonitorNotice;
try { ({ parseMonitorNotice, MonitorNotice } = require('../client/MonitorNotice.tsx')); } finally { Module._load = load; }

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
    assert.deepEqual(parseMonitorNotice(text), { summary: `Ryugi · ${summary}`, text });
  }
  for (const text of ['普通消息', 'Ryugi monitor: ryugi-answers\n通知\n{broken', 'Ryugi monitor: ryugi-answers\n通知\nnull']) {
    assert.equal(parseMonitorNotice(text), undefined);
  }
});

test('通知默认折叠，悬停显示箭头，点击展开原文并可再次收起', () => {
  state = [];
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
  button(tree).props.onPress();
  assert.equal(render().props.children[1], false);
});
