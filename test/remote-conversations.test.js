'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { remoteConversations, quote } = require('../bin/remote-conversations');
const { parseSelection } = require('../bin/session-selection');

test('remote-conversations shows bounded references, origin, stale state and quoted manual guidance', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-refs-'));
  try {
    fs.mkdirSync(path.join(dir,'desk-sync'));
    const write = (name,data) => fs.writeFileSync(path.join(dir,'desk-sync',name),JSON.stringify(data));
    write('config.json',{peerOrigin:'devbox',sshHost:'devbox'});
    const peer={version:1,origin:'devbox',generatedAt:1,receivedAt:1,sessions:[{id:'a'.repeat(32),mtime:1,cwd:"/tmp/it's $(false)",file:'/tmp/session.jsonl',title:'title\x1b[2J'}]};
    write('peer.json',peer);
    const [row]=remoteConversations(dir,200000);
    assert.equal(row.remote,true);
    assert.match(row.title,/devbox · offline\/stale/);
    assert.ok(!row.title.includes('\x1b'));
    assert.match(row.resumeNotice,/ownership unknown/);
    assert.match(row.resumeCommand,/^ssh -t 'devbox'/);
    assert.equal(quote("a'b"),"'a'\\''b'");
    const selection={version:1,remoteConversation:{notice:row.resumeNotice,command:row.resumeCommand}};
    assert.deepEqual(parseSelection(JSON.stringify(selection)),selection);
    assert.throws(()=>parseSelection(JSON.stringify({version:1,remoteConversation:{notice:'bad\n',command:'x'}})));
    peer.origin='unexpected'; write('peer.json',peer);
    assert.deepEqual(remoteConversations(dir),[]);
    peer.origin='devbox'; peer.sessions=Array(501).fill(peer.sessions[0]); write('peer.json',peer);
    assert.deepEqual(remoteConversations(dir),[]);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
