'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const login = fs.readFileSync(path.join(root, 'public', 'login.html'), 'utf8');
const fixture = fs.readFileSync(path.join(root, 'database_dump.sql'), 'utf8');

const accounts = [
  ['admin', 'admin'],
  ['staff_malolos', 'staff'],
  ['client1', 'client'],
];

test('original demo accounts remain available as accessible, non-submitting quick-fill buttons', () => {
  const found = Array.from(login.matchAll(/<button\b[^>]*class="demo-account"[^>]*>/g), m => m[0]);
  assert.equal(found.length, accounts.length);
  for (const [username, role] of accounts) {
    const button = found.find(b => b.includes(`data-demo-user="${username}"`));
    assert.ok(button, `Missing demo button for ${role}`);
    assert.match(button, /type="button"/);
    assert.match(button, /data-demo-password="123"/);
    assert.ok(login.includes(`${username} / 123`));
    assert.match(fixture, new RegExp(`\\([0-9]+, '${username}', [^\\n]+, '${role}',`));
  }
});

test('quick-fill handler writes credentials without triggering login', () => {
  const script = login.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
  assert.ok(script, 'inline login controller missing');
  const loginCalls = [];
  const elements = {
    username: {value:''}, password: {value:'', focus(){}},
    'login-error': {style:{display:'none'},textContent:''},
    'login-form': { addEventListener(name, fn) { if(name === 'submit') this.onSubmit=fn; } },
  };
  const buttons=accounts.map(([username]) => ({
    dataset: {demoUser:username,demoPassword:'123'},
    addEventListener(name, fn) { if(name === 'click') this.click=fn; }
  }));
  vm.runInNewContext(script, {
    document: {
      getElementById: id => elements[id],
      querySelectorAll: selector => selector === '.demo-account' ? buttons : []
    },
    window: {location:{search:''}},
    URLSearchParams,
    Auth: {login(...args){loginCalls.push(args);return {success:false,message:'Test login'};}}
  });
  for (const button of buttons) {
    button.click();
    assert.equal(elements.username.value,button.dataset.demoUser);
    assert.equal(elements.password.value,'123');
    assert.equal(loginCalls.length,0, 'Demo selection must not submit or bypass auth');
  }
});
